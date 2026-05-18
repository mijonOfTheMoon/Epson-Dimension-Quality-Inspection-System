# DimInspect Backend

Fastify TypeScript yang menerima koneksi outbound dari Agent local via WebSocket, mengelola REST API + WebSocket realtime untuk Frontend, dan menyimpan event ke PostgreSQL. Auth pakai JWT (HS256) + bcrypt.

## Run local

```bash
npm install
copy .env.example .env
npm run dev
```

## Build

```bash
npm run typecheck
npm run build
npm start
```

## Docker

Standalone container (port 4000 di-publish ke host):

```bash
docker build -t diminspect-backend .
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgresql://user:password@host.docker.internal:5432/diminspect \
  -e DATABASE_SSL=false \
  -e JWT_SECRET=ganti-secret-panjang \
  -e AGENT_TOKEN=ganti-token-agent \
  diminspect-backend
```

Catatan: dalam orchestrasi `docker-compose.yml` di root repo, backend hanya `expose` port 4000 ke jaringan internal Docker. Akses publik **selalu** lewat nginx reverse proxy (`/api/*` dan `/ws*`). Port 4000 tidak terjangkau dari host.

## Environment

```text
HOST=0.0.0.0
PORT=4000
LOG_LEVEL=info
CORS_ORIGIN=*
DATABASE_URL=postgresql://diminspect:diminspect@localhost:5432/diminspect
DATABASE_SSL=false
DATABASE_POOL_MAX=10
JWT_SECRET=change-me-in-production-please-use-long-secret
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
AGENT_TOKEN=change-me-agent-shared-token
EVENT_REPLAY_LIMIT=100
```

## Database Migration

Migration otomatis saat startup (`store.init()`). Manual:

```bash
npm run migrate          # via tsx (development)
npm run migrate:prod     # setelah npm run build
```

Migration dicatat di table `schema_migrations`. Idempotent.

### Migrate ke Supabase

| Pooler                      | Port | Cocok untuk          |
|-----------------------------|------|----------------------|
| Session Pooler              | 5432 | **Migrate** + runtime |
| Transaction Pooler          | 6543 | Runtime hemat koneksi |

```bash
DATABASE_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
npm run migrate
```

## Default Credentials

Hash bcrypt (cost 10) di kolom `users.password`. Plaintext di tabel ini cuma untuk login pertama:

| Username     | Password   | Role        |
|--------------|------------|-------------|
| `admin`      | `admin123` | admin       |
| `supervisor` | `super123` | supervisor  |
| `qc1`        | `qc123`    | qc          |
| `operator1`  | `op123`    | operator    |
| `vendor1`    | `ven123`   | vendor      |

Migration v3 menghapus user lama yang masih plaintext (kolom `password` tidak diawali `$2`). Seed berikutnya selalu di-hash bcrypt.

## Protocol

Path WS di bawah adalah path **di backend**. Saat di-deploy di docker-compose, nginx mem-proxy path yang sama (`/ws*`) ke `backend:4000` — Agent dan browser tidak perlu tahu port internal.

### Agent → Backend (`/ws/agent?stationId=<id>&token=<AGENT_TOKEN>`)
- **Binary message**: JPEG frame (forward ke FrameBus).
- **Text message**: JSON event (`inspection.created`, `station.status`, `quality.alert`).

### Backend → Agent (sama socket)
- **Text JSON**: `{"type":"start"}` atau `{"type":"stop"}` untuk control kamera capture.

### Backend → Frontend
- `/ws` — event broadcast (snapshot + new event).
- `/ws/frames` — frame broadcast binary, format: `[2-byte BE stationId length][stationId UTF-8][JPEG]`.

## REST API

Auth:
- `POST /api/auth/login` → `{ user, token }`
- `GET  /api/auth/me` (Bearer) → user
- `POST /api/auth/logout` → 204

Data:
- `GET  /health`
- `GET  /api/dashboard/summary`
- `GET  /api/inspections`
- `POST /api/inspections`
- `GET  /api/stations`
- `GET  /api/alerts`
- `GET  /api/parts`
- `GET  /api/users`
- `GET  /api/quality-records`
- `PATCH /api/quality-records/:id/status` (Bearer)

Agent control:
- `GET  /api/agents` → daftar agent online + running flag
- `POST /api/agents/:stationId/command` body `{"command":"start"|"stop"}` (Bearer)
