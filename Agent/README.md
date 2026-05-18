# DimInspect Agent

Agent OpenCV yang berjalan di mesin operator local. Connect outbound WebSocket ke backend VPS, default state **idle**. Backend mengirim command `start`/`stop` untuk mulai/menghentikan capture kamera, lalu agent stream JPEG binary + event inspeksi via socket yang sama. Tidak butuh broker eksternal, tidak butuh port inbound.

## Run local

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python computer_vision.py
```

## Environment

```text
STATION_ID=station-1
CAMERA_ID=camera-1
CAMERA_INDEX=0
MODEL_VERSION=vision-v1
BACKEND_WS_URL=ws://localhost:4000/ws/agent
AGENT_TOKEN=change-me-agent-shared-token
FRAME_FPS=10
FRAME_QUALITY=70
SHOW_PREVIEW=false
```

- `BACKEND_WS_URL` ke alamat backend VPS (gunakan `wss://` di production).
- `AGENT_TOKEN` harus sama dengan `AGENT_TOKEN` di Backend.
- `FRAME_FPS` target stream frame per detik.
- `FRAME_QUALITY` JPEG quality 1-100.
- `SHOW_PREVIEW` `true` untuk buka jendela OpenCV (development).

## Protocol

Agent membuka satu WebSocket ke `${BACKEND_WS_URL}?stationId=<id>&token=<AGENT_TOKEN>`. Reconnect otomatis dengan backoff eksponensial (1s → 30s cap).

- **Outbound text** (JSON): `inspection.created`, `station.status` (dengan field `running`).
- **Outbound binary**: JPEG frame (saat running).
- **Inbound text** (JSON command): `{"type":"start"}`, `{"type":"stop"}`.

Saat idle, kamera **tidak** dibuka — sumber daya bebas. Status `online` dengan `running:false` tetap dikirim tiap 5 detik supaya UI tahu agent hidup.

## Autostart Windows (Task Scheduler)

```text
Action:    Start a program
Program:   D:\path\Agent\.venv\Scripts\python.exe
Arguments: D:\path\Agent\computer_vision.py
Start in:  D:\path\Agent
Trigger:   At log on (or At startup with system account)
Settings:  Restart on failure every 1 minute, up to 99 attempts
```

Alternatif: NSSM (`nssm install DimInspectAgent`) untuk register sebagai Windows Service.

## Validation

```bash
python -m py_compile agent_link.py computer_vision.py config.py vision.py
```
