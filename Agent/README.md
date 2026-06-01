# DimInspect Agent

Agent Python OpenCV berjalan di mesin operator dan connect outbound ke HiveMQ MQTT untuk standby command/presence. Data inspeksi/status dikirim ke backend lewat HTTP, dan live video dipublish ke Cloudflare Realtime/WebRTC saat sesi berjalan.

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
BACKEND_HTTP_URL=http://localhost:4000
AGENT_TOKEN=change-me-agent-shared-token

MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USERNAME=diminspect
MQTT_PASSWORD=change-me
MQTT_TOPIC_PREFIX=diminspect/development
MQTT_USE_TLS=true

CLOUDFLARE_REALTIME_ENABLED=false
CLOUDFLARE_REALTIME_APP_ID=
CLOUDFLARE_REALTIME_APP_SECRET=
CLOUDFLARE_REALTIME_API_BASE_URL=https://rtc.live.cloudflare.com/v1
```

## Behavior

- Saat idle, kamera tidak dibuka.
- Agent publish retained MQTT presence agar UI/backend tahu station hidup tanpa membuat Cloud Run tetap warm.
- Command inbound: `start`, `stop`, `capture`, `recalibrate`.
- Frame live dipublish ke Cloudflare Realtime saat running.
- Snapshot JPEG untuk histori dikirim bersama multipart HTTP inspection ingest.
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
python -m py_compile computer_vision.py config.py http_client.py mqtt_link.py webrtc_publisher.py vision.py
```
