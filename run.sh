#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/bpm.pid"
LOG_FILE="$ROOT_DIR/bpm.log"

is_running() {
  [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "BPM Studio è già attivo (PID $(cat "$PID_FILE"))."
    exit 0
  fi

  rm -f "$PID_FILE"
  cd "$ROOT_DIR"
  nohup python3 app.py >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1

  if is_running; then
    echo "BPM Studio avviato: http://0.0.0.0:8080"
    echo "PID: $(cat "$PID_FILE")"
    echo "Log: $LOG_FILE"
  else
    echo "Avvio non riuscito. Controlla $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop() {
  if ! is_running; then
    echo "BPM Studio non è attivo."
    rm -f "$PID_FILE"
    exit 0
  fi

  pid="$(cat "$PID_FILE")"
  kill "$pid"

  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid"
  fi

  rm -f "$PID_FILE"
  echo "BPM Studio arrestato."
}

status() {
  if is_running; then
    echo "BPM Studio attivo (PID $(cat "$PID_FILE")) — http://0.0.0.0:8080"
  else
    echo "BPM Studio non è attivo."
    exit 1
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  logs) tail -f "$LOG_FILE" ;;
  *)
    echo "Uso: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
