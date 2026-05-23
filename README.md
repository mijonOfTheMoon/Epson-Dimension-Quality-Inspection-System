# DimInspect

Sistem inspeksi dimensi berbasis computer vision dengan Agent Python OpenCV, Backend Rust Axum, Frontend Svelte 5, PostgreSQL + TimescaleDB, dan nginx reverse proxy.

## Architecture

```text
[Agent PC: Python OpenCV] --WS--> [nginx proxy] --WS--> [Backend Rust Axum]
                                      |
[Browser: Svelte UI] -------HTTP/WS---+
                                      |
                         [PostgreSQL + TimescaleDB] + [Cloudflare R2 optional]
```

- Browser hanya bicara ke nginx proxy di `http://localhost`.
- Backend port `4000` dan frontend port `8080` hanya exposed di Docker network.
- Agent connect outbound ke `/ws/agent`; tidak butuh inbound port.
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
| Realtime events    | `ws://localhost/ws`           |
| Agent socket       | `ws://localhost/ws/agent`     |
| Live frame stream  | `ws://localhost/ws/frames`    |
| PostgreSQL         | `localhost:5432`              |

## Main Features

- Dashboard realtime dari tabel `inspections`: total OK/NG, tren harian, dimensi sering NG, part berisiko, dan scan terbaru.
- Live Tracking: stream kamera, start/stop/capture/recalibrate agent, bounding box selectable, stats dimensi, dan reset overlay lokal.
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
```

Agent env:

```text
STATION_ID=Station 1
CAMERA_INDEX=0
BACKEND_WS_URL=ws://localhost/ws/agent
AGENT_TOKEN=change-me-agent-shared-token
```

Untuk domain HTTPS, gunakan `wss://your-domain.example.com/ws/agent`.

## Project Notes

- Backend schema source of truth ada di `Backend/migrations/20240101000001_initial.up.sql`.
- Tidak ada migration incremental untuk initial setup.
- Frontend memakai relative path tetap: `/api/*`, `/ws`, dan `/ws/frames`.
- Agent manual capture hanya mengirim inspection saat ada detection valid.

## Validation

```bash
cd Frontend && npm run check && npm run build
cd Backend && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd Agent && python -m py_compile agent_link.py computer_vision.py config.py vision.py
docker compose config
```
