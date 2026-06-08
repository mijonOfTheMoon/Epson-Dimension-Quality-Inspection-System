# DimInspect Backend

Rust 1.91 + Axum API untuk auth, inspections, agents (command), parts, users, dashboard, quality records, MQTT command publishing, agent HTTP inspection ingest, R2 snapshot upload, Cloudflare Realtime viewer signaling, realtime MQTT connection info untuk browser, dan berbagi rekap ke channel eksternal.

## Run

```powershell
cp .env.example .env
docker compose up --build
```

Service listen di `PORT` dan expose:

- `GET /health` dan `GET /api/health`
- REST endpoints di `/api/*`
- Agent ingest: `POST /api/agent/inspections`
- Realtime presence config: `GET /api/realtime/mqtt` (URL WSS broker + kredensial subscribe-only)
- Hapus kamera (admin): `DELETE /api/stations/{stationId}`
- Viewer signaling: `POST /api/video/stations/{stationId}/viewer-session`
- Channel berbagi aktif: `GET /api/share/channels`
- Bagikan rekap terfilter: `POST /api/share/recap`

## Data

- PostgreSQL 17 dengan native partitioning untuk `inspections`, dikelola oleh `pg_partman`.
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
MQTT_PRESENCE_STALE_AFTER_MS=15000
MQTT_WS_USERNAME=
MQTT_WS_PASSWORD=

CLOUDFLARE_REALTIME_ENABLED=false
CLOUDFLARE_REALTIME_APP_ID=...
CLOUDFLARE_REALTIME_APP_SECRET=...
```

- `MQTT_USERNAME`/`MQTT_PASSWORD` dipakai backend & agent (publisher penuh).
- Station liveness adalah retained MQTT presence (single source of truth) — tidak ada tabel `stations` maupun heartbeat HTTP. Backend membaca retained presence sebelum publish command dan menganggap presence stale sebagai offline setelah `MQTT_PRESENCE_STALE_AFTER_MS`.
- Browser tidak polling status ke backend; ia subscribe presence langsung ke broker via MQTT-over-WebSocket. `GET /api/realtime/mqtt` mengembalikan URL WSS (`wss://<host>:8084/mqtt`) + kredensial. Untuk least-privilege, set `MQTT_WS_USERNAME`/`MQTT_WS_PASSWORD` ke user broker khusus subscribe-only pada topik presence; jika kosong, backend fallback ke kredensial publisher penuh.
- Hapus kamera (`DELETE /api/stations/{id}`, admin saja) mem-publish command `shutdown` (agent lokal berhenti total) lalu meng-clear retained presence agar hilang dari tampilan.
- Video subscriber dibuat lewat backend supaya Cloudflare app secret tidak dikirim ke browser.

## Bagikan Rekap

Rekap inspeksi terfilter (pencarian, status, part, rentang waktu) dibagikan ke channel eksternal lewat backend; semua kredensial provider ada di server, tidak pernah di browser.

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=
DISCORD_WEBHOOK_URL=
FONNTE_TOKEN=
FONNTE_TARGET=
```

- `GET /api/share/channels` mengembalikan channel yang kredensialnya lengkap; channel tanpa konfigurasi tidak ditawarkan.
- `POST /api/share/recap` menerima daftar channel, penerima email, dan filter; backend meng-query ulang data sesuai filter, merender template per channel, lalu mengirim. Hasil dikembalikan per-channel.
- Telegram, Discord, dan WhatsApp (Fonnte) memakai tujuan tetap dari env. Email (Brevo) memakai penerima yang diinput pengguna.
- Judul dan isi rekap menyesuaikan filter: NG menonjolkan temuan, OK menonjolkan kelolosan, part tunggal menampilkan rincian per dimensi.

## Validation

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
