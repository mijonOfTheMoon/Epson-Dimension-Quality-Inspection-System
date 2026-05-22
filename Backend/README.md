# DimInspect Backend Rust

Rust + Axum rebuild of the DimInspect backend. It keeps the same REST and WebSocket contract as the Fastify service while moving persistence to `sqlx` migrations and TimescaleDB.

## Run locally

```powershell
cp .env.example .env
docker compose up --build
```

The service listens on `PORT` and exposes:

- `GET /health`
- `GET /api/health`
- REST endpoints under `/api/*`
- WebSockets at `/ws`, `/ws/frames`, and `/ws/agent`

## Notes

- Existing bcrypt hashes remain valid via the `bcrypt` crate.
- The database image must include the TimescaleDB extension. The root `docker-compose.yml` uses a TimescaleDB PostgreSQL 17 image.
- Migration v9 converts `inspections` into a hypertable and creates `dashboard_aggregates_daily`.
- Migration v10 removes shift and batch tables/columns. The legacy React shift/batch UI is intentionally out of scope and may receive 404s until the Svelte rebuild lands.
- Override `JWT_SECRET` and `AGENT_TOKEN` in production; the example values are development placeholders only.
