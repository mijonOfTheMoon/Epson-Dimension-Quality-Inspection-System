# DimInspect Backend

Backend menyediakan REST API, WebSocket realtime, dan MQTT ingestion untuk agent inspeksi.

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

```bash
docker build -t diminspect-backend .
docker run --rm -p 4000:4000 -e STORAGE_DRIVER=postgres -e DATABASE_URL=postgresql://user:password@host.docker.internal:5432/diminspect -e DATABASE_SSL=false diminspect-backend
```

## Environment

```text
HOST=0.0.0.0
PORT=4000
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://diminspect:diminspect@localhost:5432/diminspect
DATABASE_SSL=false
DATABASE_POOL_MAX=10
MQTT_ENABLED=false
MQTT_URL=mqtt://localhost:1883
MQTT_TOPIC_PREFIX=diminspect
```

Supabase:

```text
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://postgres.xxx:password@aws-0-region.pooler.supabase.com:6543/postgres
DATABASE_SSL=true
DATABASE_POOL_MAX=10
```

## Database migration

Migration otomatis berjalan saat backend startup. Untuk menjalankan manual:

```bash
npm run migrate
```

Local PostgreSQL:

```bash
copy .env.example .env
npm run migrate
```

Supabase:

```bash
copy .env.example .env
npm run migrate
```

Untuk Supabase, isi `.env` dengan pooler `DATABASE_URL` dari Supabase dan `DATABASE_SSL=true`. Migration dicatat di table `schema_migrations`.

Production build:

```bash
npm run build
npm run migrate:prod
```

## Protocol

- Agent publish event lewat MQTT topic `diminspect/{stationId}/inspection`
- Frontend baca data awal lewat REST
- Frontend menerima update realtime lewat WebSocket `/ws`

## API

- `GET /health`
- `GET /api/inspections`
- `POST /api/inspections`
- `GET /api/stations`
- `GET /api/alerts`
- `GET /api/parts`
- `GET /api/users`
- `POST /api/auth/login`
- `GET /api/quality-records`
- `PATCH /api/quality-records/:id/status`
