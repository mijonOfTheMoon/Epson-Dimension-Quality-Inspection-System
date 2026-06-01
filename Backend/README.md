# DimInspect Backend

Rust 1.91 + Axum API untuk auth, inspections, stations, agents, parts, users, dashboard, quality records, MQTT command publishing, agent HTTP ingest, R2 snapshot upload, dan Cloudflare Realtime viewer signaling.

## Run

```powershell
cp .env.example .env
docker compose up --build
```

Service listen di `PORT` dan expose:

- `GET /health` dan `GET /api/health`
- REST endpoints di `/api/*`
- Agent ingest: `POST /api/agent/status`, `POST /api/agent/inspections`
- Viewer signaling: `POST /api/video/stations/{stationId}/viewer-session`

## Data

- PostgreSQL + TimescaleDB.
- Schema clean source: `migrations/20240101000001_initial.up.sql`.
- Static seed users dan seed parts ada di `src/storage/seed.rs`.
- Dashboard summary dihitung langsung dari `inspections`.
- Multi-detection capture disimpan sebagai row inspection terpisah, dengan metadata frame R2 yang sama.

## Object Store

Cloudflare R2 bersifat opsional. Aktifkan dengan:

```text
OBJECT_STORE_ENABLED=true
OBJECT_STORE_BUCKET=diminspect-frames
OBJECT_STORE_ACCOUNT_ID=...
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...
```

Jika aktif, backend wajib memiliki semua credential R2. Snapshot JPEG dari agent HTTP ingest diupload sinkron sebelum metadata inspection ditandai, lalu history/thumbnail memakai signed URL.

## MQTT + Video

```text
MQTT_HOST=...
MQTT_PORT=8883
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_TOPIC_PREFIX=diminspect/development

CLOUDFLARE_REALTIME_ENABLED=false
CLOUDFLARE_REALTIME_APP_ID=...
CLOUDFLARE_REALTIME_APP_SECRET=...
```

Backend membaca retained MQTT presence sebelum publish command. Video subscriber dibuat lewat backend supaya Cloudflare app secret tidak dikirim ke browser.

## Validation

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
