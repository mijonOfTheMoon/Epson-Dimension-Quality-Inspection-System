# DimInspect

Sistem quality inspection dimensi dengan agent computer vision di mesin local, backend + frontend di VPS, terhubung via WebSocket langsung (tanpa broker eksternal).

## Arsitektur

```text
[Operator PC: Agent (OpenCV)]  --outbound WSS-->  [VPS: Backend (Fastify)]
                                                       |
                                                       +-- /ws/agent      (Agent control + event + frame)
                                                       +-- /ws            (Realtime event broadcast)
                                                       +-- /ws/frames     (Frame broadcast ke viewer)
                                                       +-- REST API       (Auth, agents, inspections, dst)
                                                       |
                                                  [PostgreSQL]
                                                       |
[Browser: Frontend (React)] <-- HTTPS + WSS --> [Backend]
```

- **Agent (Python OpenCV)** berjalan di PC operator, persistent outbound WebSocket ke backend. Default state **idle** sampai menerima command `start` dari backend.
- **Backend (Fastify TS)** menerima event + frame dari agent, broadcast ke viewer, expose REST + WebSocket.
- **Frontend (React Vite)** punya tombol **Mulai/Hentikan Inspeksi** per station; menampilkan video tile live dari frame WebSocket.

## Default Credentials

Demo seed users. Password tersimpan sebagai hash bcrypt di DB (cost 10) — plaintext di tabel ini hanya untuk login pertama.

| Username     | Password   | Role        | Nama              |
|--------------|------------|-------------|-------------------|
| `admin`      | `admin123` | admin       | Administrator     |
| `supervisor` | `super123` | supervisor  | Budi Santoso      |
| `qc1`        | `qc123`    | qc          | Sari Dewi         |
| `operator1`  | `op123`    | operator    | Andi Pratama      |
| `vendor1`    | `ven123`   | vendor      | PT. Maju Jaya     |

Ganti password seed di production segera setelah login pertama (endpoint update password = roadmap berikut).

## Docker compose

```bash
docker compose up --build
```

Semua trafik publik via nginx reverse proxy di port **80**. Backend (port 4000) hanya di-`expose` ke jaringan internal Docker, **tidak** dipublish ke host.

Endpoint publik:

| Tujuan                       | URL                                   |
|------------------------------|---------------------------------------|
| Frontend UI                  | `http://localhost/`                   |
| REST API                     | `http://localhost/api/*`              |
| Backend health (via proxy)   | `http://localhost/api/health`         |
| WebSocket event realtime     | `ws://localhost/ws`                   |
| WebSocket agent ingest       | `ws://localhost/ws/agent`             |
| WebSocket frame viewer       | `ws://localhost/ws/frames`            |
| PostgreSQL (host port)       | `localhost:5432`                      |

`nginx.conf` melakukan rewrite `/api/(.*) → /$1` ke `backend:4000`, dan prefix `/ws*` di-proxy dengan Upgrade header untuk WebSocket.

Stop & reset data:

```bash
docker compose down
docker compose down -v
```

## Local Development

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

Agent (di mesin operator):

```bash
cd Agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python computer_vision.py
```

## Environment

Backend (`Backend/.env`) — untuk `npm run dev` (standalone, port 4000 langsung):

```text
PORT=4000
DATABASE_URL=postgresql://diminspect:diminspect@localhost:5432/diminspect
DATABASE_SSL=false
DATABASE_POOL_MAX=10
JWT_SECRET=change-me-in-production-please-use-long-secret
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10
AGENT_TOKEN=change-me-agent-shared-token
EVENT_REPLAY_LIMIT=100
```

Di docker-compose, env yang sama di-pass via `environment:` di `docker-compose.yml` (gunakan host env atau `.env` di root repo untuk override `JWT_SECRET` & `AGENT_TOKEN`).

Frontend build args — dua mode:

| Mode                          | `VITE_API_URL`            | `VITE_WS_URL`            | `VITE_FRAME_WS_URL`         |
|-------------------------------|---------------------------|--------------------------|-----------------------------|
| Local dev (vite + backend `npm run dev`) | `http://localhost:4000`   | `ws://localhost:4000/ws` | `ws://localhost:4000/ws/frames` |
| Docker compose / production   | `/api`                    | `/ws`                    | `/ws/frames`                |

Mode produksi pakai path relatif → browser resolve ke origin sendiri (host yang melayani frontend), nginx proxy yang forward ke backend.

Agent (`Agent/.env`) — dua skenario:

```text
# Local dev: backend `npm run dev` di mesin yang sama
BACKEND_WS_URL=ws://localhost:4000/ws/agent

# Production: backend di VPS dibalik nginx
BACKEND_WS_URL=wss://your-domain.example.com/ws/agent
```

```text
STATION_ID=station-1
CAMERA_ID=camera-1
CAMERA_INDEX=0
MODEL_VERSION=vision-v1
AGENT_TOKEN=change-me-agent-shared-token
FRAME_FPS=10
FRAME_QUALITY=70
SHOW_PREVIEW=false
```

### Identitas vs Otorisasi Agent

| Variabel       | Fungsi                                                                | Unik per agent? |
|----------------|-----------------------------------------------------------------------|------------------|
| `STATION_ID`   | Identitas logis agent (mis. `station-1`, `station-cnc-a`)             | **Ya** — wajib unik |
| `AGENT_TOKEN`  | Shared secret untuk otorisasi koneksi WS agent → backend              | **Tidak** — sama untuk semua agent |

`AGENT_TOKEN` **bukan** identifier per agent. Ia hanya shared bearer secret: agent manapun yang tahu token bisa connect dengan `stationId` apapun. Cukup untuk MVP di LAN/VPN. Untuk multi-tenant atau jaringan kurang terpercaya, upgrade ke per-agent token (JWT signed per `stationId` atau row di tabel `agent_tokens`) — belum diimplementasikan.

### Generate Secrets

`AGENT_TOKEN` dan `JWT_SECRET` adalah string random yang Anda buat sendiri. Buat sekali, set di kedua sisi.

```bash
# Linux / macOS / Git Bash
openssl rand -hex 32

# Windows PowerShell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin output ke `Backend/.env` (`AGENT_TOKEN=...`, `JWT_SECRET=...`) dan ke `Agent/.env` (`AGENT_TOKEN=...` saja — harus sama persis dengan backend). `STATION_ID` di-set berbeda untuk setiap agent.

## Database Migration

Backend menjalankan migration otomatis saat startup (`store.init()`). Idempotent, dicatat di table `schema_migrations`. Migrate manual:

```bash
cd Backend
npm run migrate
```

### Migrate ke Supabase

Supabase punya dua pooler:

- **Session Pooler (port 5432)** — kompatibel penuh, prepared statements OK. **Gunakan untuk migrate.**
- **Transaction Pooler (port 6543)** — untuk runtime hemat koneksi.

Steps:

```bash
# Migrate sekali via session pooler
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_SSL=true
npm run migrate

# Untuk runtime (production), boleh switch ke transaction pooler
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_SSL=true
```

## Validation

```bash
cd Backend  && npm run typecheck && npm run build
cd Frontend && npm run build
cd Agent    && python -m py_compile agent_link.py computer_vision.py config.py vision.py
```
