# DimInspect

Sistem inspeksi dimensi berbasis computer vision dengan Agent Python OpenCV, Backend Rust Axum, Frontend Svelte 5, PostgreSQL 17 + native partitioning/pg_partman, dan nginx reverse proxy.

## Architecture

```text
[Browser: Svelte UI] ----REST----> [nginx proxy] ----REST----> [Backend Rust Axum]
[Browser: Svelte UI] --MQTT/WSS (subscribe presence)--> [EMQX broker]
                                                              |
[Agent PC: Python OpenCV] --MQTT--> [EMQX] <--MQTT command----+
[Agent PC: Python OpenCV] --HTTP inspection (capture only)--->+
[Agent PC: Python OpenCV] --WebRTC video--> [Cloudflare Realtime] <--WebRTC-- [Browser]
                                                              |
                                      [PostgreSQL 17 + pg_partman] + [Cloudflare R2 optional]
```

- Browser bicara ke nginx proxy untuk REST, dan **langsung ke EMQX broker via MQTT-over-WebSocket** untuk presence/status kamera realtime (memakai kredensial broker khusus subscribe-only).
- Station liveness adalah retained MQTT presence (single source of truth) — tidak ada lagi tabel `stations` atau heartbeat HTTP.
- Backend port `4000` dan frontend port `8080` hanya exposed di Docker network.
- Agent standby via MQTT; HTTP outbound hanya untuk capture inspection. Tidak butuh inbound port.
- Frame capture disimpan ke Cloudflare R2 jika object store aktif.

## Run

```bash
docker compose up --build
```

Endpoint publik:

| Tujuan             | URL                           |
|--------------------|-------------------------------|
| Frontend UI        | `http://localhost/`           |
| REST API           | `http://localhost/api/*`      |
| Health             | `http://localhost/api/health` |
| PostgreSQL         | `localhost:5432`              |

## Main Features

- Dashboard realtime dari tabel `inspections`: total OK/NG, tren harian, dimensi sering NG, part berisiko, dan scan terbaru.
- Live Tracking: stream kamera, start/stop/capture/recalibrate agent, bounding box realtime yang selectable (presence + deteksi via MQTT-over-WebSocket langsung dari broker), analisis dimensi, dan reset overlay. Hapus kamera (admin saja) mematikan agent lokal dan menghapusnya dari tampilan.
- Riwayat Inspeksi: tabel inspection history, detail measurement, dan thumbnail frame R2 bila tersedia.
- Quality Tracking: rekap harian per part, NG rate, status request vendor, dan status history.
- Konfigurasi Part/User: tabel utama dengan search/filter dan halaman editor terpisah.

## Default Users

| Username     | Password   | Role        |
|--------------|------------|-------------|
| `admin`      | `admin123` | admin       |
| `supervisor` | `super123` | supervisor  |
| `qc1`        | `qc123`    | qc          |
| `operator1`  | `op123`    | operator    |
| `vendor1`    | `ven123`   | vendor      |
| `engineer1`  | `eng123`   | engineering |

## Environment

Backend env diatur di `docker-compose.yml`; override secret lewat host env atau `.env` root.

```text
APP_TIMEZONE=Asia/Jakarta
JWT_SECRET=change-me-in-production-please-use-long-secret
AGENT_TOKEN=change-me-agent-shared-token
OBJECT_STORE_ENABLED=false
MQTT_HOST=
MQTT_WS_USERNAME=
MQTT_WS_PASSWORD=
CLOUDFLARE_REALTIME_ENABLED=false
```

`MQTT_WS_USERNAME`/`MQTT_WS_PASSWORD` adalah kredensial broker khusus subscribe-only yang dibagikan ke browser untuk presence realtime. Jika kosong, backend fallback ke `MQTT_USERNAME`/`MQTT_PASSWORD` (kurang aman karena memberi akses penuh ke browser).

Agent env:

```text
STATION_ID=Station 1
CAMERA_INDEX=0
BACKEND_HTTP_URL=http://localhost:4000
AGENT_TOKEN=change-me-agent-shared-token
MQTT_HOST=
```

## Project Notes

- Backend schema source of truth ada di `backend/migrations/20240101000001_initial.up.sql`.
- Tidak ada migration incremental untuk initial setup.
- Database local dan Supabase Postgres 17 memakai native range partitioning untuk `inspections`, dengan maintenance partisi lewat `pg_partman` dan `pg_cron`.
- Frontend memakai relative path `/api/*` dan polling untuk data non-realtime; presence/status kamera di Live Tracking dibaca langsung dari broker via MQTT-over-WebSocket.
- Agent manual capture hanya mengirim inspection saat ada detection valid.
- Satu `STATION_ID` hanya boleh dipakai satu agent; agent menerapkan strict anti-race saat start (yang kalah otomatis berhenti).
- Panduan migrasi database ke Supabase Postgres 17 + pg_partman ada di `docs/supabase.md`.

## Validation

```bash
cd frontend && npm run check && npm run build
cd backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd agent && python -m py_compile main.py config.py http_client.py mqtt_link.py webrtc_publisher.py vision.py
docker compose config
```
