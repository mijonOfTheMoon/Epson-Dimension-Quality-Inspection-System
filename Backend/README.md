# DimInspect Backend

Rust 1.91 + Axum API untuk auth, inspections, stations, agents, parts, users, dashboard, quality records, realtime events, frame stream, dan agent WebSocket.

## Run

```powershell
cp .env.example .env
docker compose up --build
```

Service listen di `PORT` dan expose:

- `GET /health` dan `GET /api/health`
- REST endpoints di `/api/*`
- WebSocket events di `/ws`
- Frame stream di `/ws/frames`
- Agent socket di `/ws/agent`

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

Jika aktif, backend upload satu frame per capture dan mengembalikan signed URL untuk history/thumbnail.

## Validation

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
