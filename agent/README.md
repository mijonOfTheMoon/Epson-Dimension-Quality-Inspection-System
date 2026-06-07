# DimInspect Agent

Agent Python OpenCV berjalan di mesin operator dan connect outbound ke MQTT untuk standby command/presence. Data inspeksi dikirim ke backend lewat HTTP; status & presence station di-publish realtime ke MQTT (bukan lagi via HTTP). Live video dipublish ke Cloudflare Realtime/WebRTC saat sesi berjalan.

## Run

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python main.py
```

## Environment

```text
STATION_ID=Station 1
AGENT_LOG_LEVEL=INFO
CAMERA_INDEX=0
BACKEND_HTTP_URL=http://localhost:4000
AGENT_TOKEN=change-me-agent-shared-token

MQTT_HOST=your-broker-host.emqxsl.com
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
- Agent publish retained MQTT presence agar UI tahu station hidup tanpa membuat Cloud Run tetap warm. Frontend membaca presence ini langsung dari broker via WebSocket (tidak lewat backend).
- Command inbound: `start`, `stop`, `capture`, `recalibrate`, `shutdown`.
- **Single-owner per `STATION_ID` (strict anti-race):** saat start, agent men-subscribe presence/claim topic, mem-publish klaim (`instanceId` + `connectedAt`), lalu menunggu ~2.5 dtk. Jika ada presence lain yang masih fresh atau klaim lain yang lebih sah (`connectedAt` lebih awal, tiebreak `instanceId`), agent ini langsung berhenti tanpa menimpa presence pemilik. Hanya satu agent yang bertahan untuk satu station id.
- **`shutdown` (dipicu admin saat "Hapus kamera"):** agent menghentikan inspeksi, meng-clear retained presence-nya (UI langsung menghilangkan kamera), lalu keluar dari proses — setara menekan Ctrl+C di terminal lokal.
- Frame live dipublish ke Cloudflare Realtime saat running.
- Snapshot JPEG untuk histori dikirim bersama multipart HTTP inspection ingest.
- Manual capture hanya mengirim `inspection.created` jika ada detection valid.
- `STATION_ID` wajib unik per agent dan `AGENT_TOKEN` harus sama dengan backend.
- `AGENT_LOG_LEVEL` opsional; gunakan `INFO` untuk operasional normal, `DEBUG` saat troubleshooting lokal.

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
Arguments: D:\path\Agent\main.py
Start in:  D:\path\Agent
Trigger:   At log on
Settings:  Restart on failure every 1 minute, up to 99 attempts
```

## Validation

```powershell
python -m py_compile main.py config.py http_client.py mqtt_link.py webrtc_publisher.py vision.py
```
