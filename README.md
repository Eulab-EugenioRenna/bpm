# BPM Studio

PWA con metronomo audio, controllo BPM in tempo reale e libreria di playlist/brani persistita in SQLite.

## Avvio

```bash
python3 app.py
```

Il server ascolta su `0.0.0.0:8080`. Apri `http://IP-DEL-SERVER:8080` da un dispositivo della rete. Il database `bpm.sqlite3` viene creato automaticamente al primo avvio.

Su Linux puoi avviarla in background con:

```bash
./run.sh
```

Sono disponibili anche `./run.sh stop`, `restart`, `status` e `logs`.

Per installarla come app, usa **Installa app** dal menu del browser dopo aver aperto la pagina.

## Funzioni

- Player BPM con click sonoro, play/pausa e indicatore visivo
- Slider continuo 20–300 con tacche di riferimento
- Modifica diretta del valore BPM cliccando sul numero
- Regolazioni rapide `−10`, `−1`, `+1`, `+10`
- Schermata Brani separata
- Playlist e brani salvati in SQLite
- Richiamo immediato del BPM di un brano nel player
- Layout responsive e manifest PWA con cache dell'interfaccia
