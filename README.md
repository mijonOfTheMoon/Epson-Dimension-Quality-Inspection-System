# DimInspect

DimInspect adalah sistem quality inspection dimensi dengan agent vision, backend ingestion, dan frontend monitoring realtime.

## Arsitektur

- **Agent**: Python OpenCV, publish event inspeksi via MQTT, fallback HTTP, buffer offline JSONL.
- **Backend**: Fastify TypeScript, REST API, WebSocket realtime, MQTT subscriber, PostgreSQL storage.
- **Frontend**: React Vite dashboard, REST initial load, WebSocket realtime, mock fallback.

## Struktur

```text
Agent/
Backend/
Frontend/
docker-compose.yml
```

## Docker compose

```bash
docker compose up --build
```

Akses:

- Frontend: http://localhost:8080
- Backend health: http://localhost:4000/health
- WebSocket: ws://localhost:4000/ws
- PostgreSQL: localhost:5432

Stop:

```bash
docker compose down
```

Reset data volume:

```bash
docker compose down -v
```

## Local development

Backend:

```bash
cd Backend
npm install
copy .env.example .env
npm run dev
```

Frontend:

```bash
cd Frontend
npm install
npm run dev
```

Agent:

```bash
cd Agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python computer_vision.py
```

## Environment

Backend utama:

```text
PORT=4000
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://diminspect:diminspect@postgres:5432/diminspect
DATABASE_SSL=false
DATABASE_POOL_MAX=10
MQTT_ENABLED=false
MQTT_URL=mqtt://host.docker.internal:1883
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

Backend menjalankan migration otomatis saat startup lewat `store.init()`. Migration bersifat idempotent dan dicatat di table `schema_migrations`.

Local Docker PostgreSQL:

```bash
docker compose up -d postgres
cd Backend
copy .env.example .env
npm run migrate
```

Supabase:

```bash
cd Backend
copy .env.example .env
npm run migrate
```

Untuk Supabase, isi `.env` backend dengan `DATABASE_URL` dari Supabase pooler dan `DATABASE_SSL=true` sebelum menjalankan migration.

Production image:

```bash
npm run build
npm run migrate:prod
```

Frontend build args:

```text
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000/ws
```

Agent local ke compose:

```text
MQTT_ENABLED=true
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_TOPIC_PREFIX=diminspect
HTTP_FALLBACK_URL=http://localhost:4000/api/inspections
```

## Validation

```bash
cd Backend && npm run typecheck && npm run build
cd Frontend && npm run build
cd Agent && python -m py_compile computer_vision.py config.py event_buffer.py transport.py vision.py
```
