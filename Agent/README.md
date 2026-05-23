# DimInspect Agent

Agent Python OpenCV berjalan di mesin operator dan connect outbound WebSocket ke backend lewat nginx proxy. Agent tidak butuh inbound port.

## Run

```powershell
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

## Behavior

- Saat idle, kamera tidak dibuka.
- Agent tetap mengirim status `online` berkala agar UI tahu station hidup.
- Command inbound: `start`, `stop`, `capture`, `recalibrate`.
- Frame stream dikirim sebagai JPEG binary saat running.
- Manual capture hanya mengirim `inspection.created` jika ada detection valid.
- `STATION_ID` wajib unik per agent dan `AGENT_TOKEN` harus sama dengan backend.

## Vision Defaults

```text
FRAME_FPS=8
FRAME_QUALITY=62
FOREGROUND_AREA_THRESHOLD=4000
CALIBRATION_FRAMES=30
```

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

```powershell
python -m py_compile agent_link.py computer_vision.py config.py vision.py
```
