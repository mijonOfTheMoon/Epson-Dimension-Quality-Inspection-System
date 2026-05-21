# DimInspect

Sistem quality inspection dimensi dengan agent computer vision, backend Fastify, frontend React, PostgreSQL, dan nginx reverse proxy.

## Architecture

```text
[Agent PC: Python OpenCV] --WS--> [nginx proxy] --WS--> [Backend Fastify]
                                      |
[Browser: React UI] --------HTTP/WS---+
                                      |
                                  [PostgreSQL]
```

- Browser hanya bicara ke nginx reverse proxy.
- Backend port `4000` hanya internal Docker network.
- Frontend tidak punya build-time API/WS environment variable.
- Agent memakai `BACKEND_WS_URL` ke endpoint proxy `/ws/agent`.

## Docker Compose

```bash
docker compose up --build
```

Endpoint publik:

| Tujuan                   | URL                         |
|--------------------------|-----------------------------|
| Frontend UI              | `http://localhost/`         |
| REST API                 | `http://localhost/api/*`    |
| Backend health           | `http://localhost/api/health` |
| Realtime WebSocket       | `ws://localhost/ws`         |
| Agent WebSocket          | `ws://localhost/ws/agent`   |
| Frame WebSocket          | `ws://localhost/ws/frames`  |
| PostgreSQL host port     | `localhost:5432`            |

Nginx meneruskan `/api/*` ke backend tanpa rewrite path dan meneruskan `/ws*` dengan Upgrade header untuk WebSocket.

## Routing

Frontend production memakai path tetap:

- REST: `/api/*`
- Realtime: `/ws`
- Frame stream: `/ws/frames`

Tidak ada build-time routing environment variable.

## Default Credentials

Demo seed users. Password tersimpan sebagai hash bcrypt di DB.

| Username     | Password   | Role        | Nama              |
|--------------|------------|-------------|-------------------|
| `admin`      | `admin123` | admin       | Administrator     |
| `supervisor` | `super123` | supervisor  | Budi Santoso      |
| `qc1`        | `qc123`    | qc          | Sari Dewi         |
| `operator1`  | `op123`    | operator    | Andi Pratama      |
| `vendor1`    | `ven123`   | vendor      | PT. Maju Jaya     |

## Backend Environment

Backend env diatur oleh `docker-compose.yml`; override lewat host env atau `.env` root repo untuk secret.

```text
JWT_SECRET=change-me-in-production-please-use-long-secret
AGENT_TOKEN=change-me-agent-shared-token
```

## Agent Environment

```text
STATION_ID=Station 1
CAMERA_INDEX=0
BACKEND_WS_URL=ws://localhost/ws/agent
AGENT_TOKEN=change-me-agent-shared-token
```

Untuk domain HTTPS, gunakan `wss://your-domain.example.com/ws/agent`.

`STATION_ID` wajib unik per agent. `AGENT_TOKEN` adalah shared bearer secret yang harus sama dengan backend.

## Validation

```bash
cd Backend  && npm run typecheck && npm run build
cd Frontend && npm run build
cd Agent    && python -m py_compile agent_link.py computer_vision.py config.py vision.py
docker compose config
```
