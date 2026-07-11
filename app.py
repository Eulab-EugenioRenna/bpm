#!/usr/bin/env python3
import json
import mimetypes
import queue
import sqlite3
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB = ROOT / "bpm.sqlite3"


class EventBus:
    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()
        self.revision = 0

    def subscribe(self):
        channel = queue.Queue(maxsize=20)
        with self.lock:
            self.clients.add(channel)
        return channel

    def unsubscribe(self, channel):
        with self.lock:
            self.clients.discard(channel)

    def publish(self, resource, action, source=""):
        with self.lock:
            self.revision += 1
            event = {"revision": self.revision, "resource": resource, "action": action, "source": source}
            clients = tuple(self.clients)
        for channel in clients:
            try:
                channel.put_nowait(event)
            except queue.Full:
                try:
                    channel.get_nowait()
                    channel.put_nowait(event)
                except queue.Empty:
                    pass


events = EventBus()


def connection():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def setup():
    with connection() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                artist TEXT NOT NULL DEFAULT '',
                bpm INTEGER NOT NULL CHECK (bpm BETWEEN 20 AND 300),
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                artist TEXT NOT NULL DEFAULT '',
                bpm INTEGER NOT NULL CHECK (bpm BETWEEN 20 AND 300),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        track_columns = {row[1] for row in db.execute("PRAGMA table_info(tracks)")}
        if "song_id" not in track_columns:
            db.execute("ALTER TABLE tracks ADD COLUMN song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL")
        if db.execute("SELECT COUNT(*) FROM playlists").fetchone()[0] == 0:
            cursor = db.execute("INSERT INTO playlists(name) VALUES (?)", ("Live set",))
            playlist_id = cursor.lastrowid
            db.executemany(
                "INSERT INTO tracks(playlist_id,title,artist,bpm,position) VALUES (?,?,?,?,?)",
                [(playlist_id, "Warm up", "", 96, 0), (playlist_id, "Main groove", "", 120, 1)],
            )
        for track in db.execute("SELECT id,title,artist,bpm FROM tracks WHERE song_id IS NULL").fetchall():
            song = db.execute("INSERT INTO songs(title,artist,bpm) VALUES (?,?,?)", (track["title"], track["artist"], track["bpm"]))
            db.execute("UPDATE tracks SET song_id=? WHERE id=?", (song.lastrowid, track["id"]))


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def translate_path(self, path):
        clean = urlparse(path).path.lstrip("/") or "index.html"
        return str(ROOT / clean)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache" if self.path.startswith("/api/") else "public, max-age=300")
        super().end_headers()

    def json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def payload(self):
        try:
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except (ValueError, json.JSONDecodeError):
            return None

    def do_GET(self):
        if urlparse(self.path).path == "/api/events":
            channel = events.subscribe()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                self.wfile.write(b"retry: 2000\nevent: ready\ndata: {}\n\n")
                self.wfile.flush()
                while True:
                    try:
                        event = channel.get(timeout=15)
                        payload = json.dumps(event, ensure_ascii=False).encode()
                        self.wfile.write(b"event: library\ndata: " + payload + b"\n\n")
                    except queue.Empty:
                        self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                events.unsubscribe(channel)
            return
        path = urlparse(self.path).path
        if path == "/api/songs":
            with connection() as db:
                songs = [dict(row) for row in db.execute("SELECT id,title,artist,bpm FROM songs ORDER BY title COLLATE NOCASE,id")]
            return self.json(songs)
        if path == "/api/library":
            with connection() as db:
                playlists = [dict(row) for row in db.execute("SELECT id,name FROM playlists ORDER BY id")]
                tracks = [dict(row) for row in db.execute(
                    "SELECT id,playlist_id,song_id,title,artist,bpm,position FROM tracks ORDER BY playlist_id,position,id"
                )]
            for playlist in playlists:
                playlist["tracks"] = [t for t in tracks if t["playlist_id"] == playlist["id"]]
            return self.json(playlists)
        super().do_GET()

    def do_POST(self):
        data = self.payload()
        if data is None:
            return self.json({"error": "JSON non valido"}, 400)
        if self.path == "/api/playlists":
            name = str(data.get("name", "")).strip()
            if not name:
                return self.json({"error": "Il nome è obbligatorio"}, 422)
            with connection() as db:
                cursor = db.execute("INSERT INTO playlists(name) VALUES (?)", (name,))
            events.publish("playlist", "created", self.headers.get("X-Client-ID", ""))
            return self.json({"id": cursor.lastrowid, "name": name, "tracks": []}, 201)
        if self.path == "/api/songs":
            try:
                title = str(data["title"]).strip()
                artist = str(data.get("artist", "")).strip()
                bpm = int(data["bpm"])
                if not title or not 20 <= bpm <= 300:
                    raise ValueError
                with connection() as db:
                    cursor = db.execute("INSERT INTO songs(title,artist,bpm) VALUES (?,?,?)", (title, artist, bpm))
                events.publish("song", "created", self.headers.get("X-Client-ID", ""))
                return self.json({"id": cursor.lastrowid}, 201)
            except (KeyError, ValueError, sqlite3.IntegrityError):
                return self.json({"error": "Dati del brano non validi"}, 422)
        if self.path == "/api/tracks":
            try:
                playlist_id, bpm = int(data["playlist_id"]), int(data["bpm"])
                title = str(data["title"]).strip()
                artist = str(data.get("artist", "")).strip()
                if not title or not 20 <= bpm <= 300:
                    raise ValueError
                with connection() as db:
                    song = db.execute("INSERT INTO songs(title,artist,bpm) VALUES (?,?,?)", (title, artist, bpm))
                    position = db.execute(
                        "SELECT COALESCE(MAX(position),-1)+1 FROM tracks WHERE playlist_id=?", (playlist_id,)
                    ).fetchone()[0]
                    cursor = db.execute(
                        "INSERT INTO tracks(playlist_id,song_id,title,artist,bpm,position) VALUES (?,?,?,?,?,?)",
                        (playlist_id, song.lastrowid, title, artist, bpm, position),
                    )
                events.publish("track", "created", self.headers.get("X-Client-ID", ""))
                return self.json({"id": cursor.lastrowid}, 201)
            except (KeyError, ValueError, sqlite3.IntegrityError):
                return self.json({"error": "Dati del brano non validi"}, 422)
        if self.path == "/api/playlist-tracks":
            try:
                playlist_id, song_id = int(data["playlist_id"]), int(data["song_id"])
                with connection() as db:
                    song = db.execute("SELECT id,title,artist,bpm FROM songs WHERE id=?", (song_id,)).fetchone()
                    if not song:
                        raise ValueError
                    if db.execute("SELECT 1 FROM tracks WHERE playlist_id=? AND song_id=?", (playlist_id, song_id)).fetchone():
                        return self.json({"error": "Il brano è già nella playlist"}, 409)
                    position = db.execute("SELECT COALESCE(MAX(position),-1)+1 FROM tracks WHERE playlist_id=?", (playlist_id,)).fetchone()[0]
                    cursor = db.execute(
                        "INSERT INTO tracks(playlist_id,song_id,title,artist,bpm,position) VALUES (?,?,?,?,?,?)",
                        (playlist_id, song_id, song["title"], song["artist"], song["bpm"], position),
                    )
                events.publish("track", "created", self.headers.get("X-Client-ID", ""))
                return self.json({"id": cursor.lastrowid}, 201)
            except (KeyError, ValueError, sqlite3.IntegrityError):
                return self.json({"error": "Brano o playlist non validi"}, 422)
        self.send_error(404)

    def do_PUT(self):
        data = self.payload()
        parts = urlparse(self.path).path.strip("/").split("/")
        if data is None or len(parts) != 3 or parts[0] != "api":
            return self.json({"error": "Richiesta non valida"}, 400)
        try:
            item_id = int(parts[2])
            with connection() as db:
                if parts[1] == "playlists":
                    name = str(data["name"]).strip()
                    if not name:
                        raise ValueError
                    db.execute("UPDATE playlists SET name=? WHERE id=?", (name, item_id))
                elif parts[1] == "tracks":
                    title, artist, bpm = str(data["title"]).strip(), str(data.get("artist", "")).strip(), int(data["bpm"])
                    if not title or not 20 <= bpm <= 300:
                        raise ValueError
                    track = db.execute("SELECT song_id FROM tracks WHERE id=?", (item_id,)).fetchone()
                    if not track:
                        return self.json({"error": "Brano non trovato"}, 404)
                    if track["song_id"]:
                        db.execute("UPDATE songs SET title=?,artist=?,bpm=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (title, artist, bpm, track["song_id"]))
                        db.execute("UPDATE tracks SET title=?,artist=?,bpm=? WHERE song_id=?", (title, artist, bpm, track["song_id"]))
                    else:
                        db.execute("UPDATE tracks SET title=?,artist=?,bpm=? WHERE id=?", (title, artist, bpm, item_id))
                else:
                    return self.send_error(404)
            events.publish(parts[1][:-1], "updated", self.headers.get("X-Client-ID", ""))
            return self.json({"ok": True})
        except (KeyError, ValueError):
            return self.json({"error": "Dati non validi"}, 422)

    def do_DELETE(self):
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "api":
            return self.send_error(404)
        try:
            item_id = int(parts[2])
            table = {"playlists": "playlists", "tracks": "tracks"}.get(parts[1])
            if not table:
                return self.send_error(404)
            with connection() as db:
                db.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
            events.publish(parts[1][:-1], "deleted", self.headers.get("X-Client-ID", ""))
            return self.json({"ok": True})
        except ValueError:
            return self.json({"error": "ID non valido"}, 400)


if __name__ == "__main__":
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    setup()
    print("BPM Studio → http://0.0.0.0:8080")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
