# DimInspect Agent

Agent OpenCV berjalan di mesin operator dan connect outbound WebSocket ke backend lewat nginx reverse proxy. Agent tidak butuh port inbound.

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python computer_vision.py
```

## Environment

```text
STATION_ID=Station 1
CAMERA_INDEX=0
BACKEND_WS_URL=ws://localhost/ws/agent
AGENT_TOKEN=change-me-agent-shared-token
```

Untuk domain HTTPS, gunakan `wss://your-domain.example.com/ws/agent`.

- `STATION_ID` wajib unik per agent.
- `AGENT_TOKEN` wajib sama dengan `AGENT_TOKEN` di backend.
- Frame stream memakai 8 FPS dan JPEG quality 62.

## Protocol

Agent membuka satu WebSocket ke `${BACKEND_WS_URL}?stationId=<id>` dengan bearer token di header. Reconnect otomatis dengan backoff eksponensial.

- Outbound text: `inspection.created`, `station.status`.
- Outbound binary: JPEG frame saat running.
- Inbound text: command `start`, `stop`, `capture`, `recalibrate`.

Saat idle, kamera tidak dibuka. Status `online` dengan `running:false` tetap dikirim berkala supaya UI tahu agent hidup.

## Autostart Windows

```text
Action:    Start a program
Program:   D:\path\Agent\.venv\Scripts\python.exe
Arguments: D:\path\Agent\computer_vision.py
Start in:  D:\path\Agent
Trigger:   At log on
Settings:  Restart on failure every 1 minute, up to 99 attempts
```

## Validation

```bash
python -m py_compile agent_link.py computer_vision.py config.py vision.py
```
