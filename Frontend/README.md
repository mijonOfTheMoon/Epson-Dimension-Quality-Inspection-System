# DimInspect Frontend

React + Vite dashboard untuk monitoring inspeksi dimensi: live video tile per station, kontrol start/stop agent, history, quality tracking, users, parts. Session persistence pakai JWT di `localStorage` + auto-rehydrate via `/api/auth/me`.

## Run local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Docker

```bash
docker build -t diminspect-frontend .
docker run --rm -p 8080:8080 diminspect-frontend
```

## Environment

```text
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000/ws
VITE_FRAME_WS_URL=ws://localhost:4000/ws/frames
```

`VITE_WS_URL` dan `VITE_FRAME_WS_URL` opsional — kalau kosong, dihitung dari `VITE_API_URL` (replace `http` → `ws`).

## Default Credentials

Demo seed (sudah di-hash bcrypt di DB):

| Username     | Password   | Role        |
|--------------|------------|-------------|
| `admin`      | `admin123` | admin       |
| `supervisor` | `super123` | supervisor  |
| `qc1`        | `qc123`    | qc          |
| `operator1`  | `op123`    | operator    |
| `vendor1`    | `ven123`   | vendor      |

## Auth Flow

1. `POST /api/auth/login` → simpan JWT di `localStorage` (`diminspect_auth_token`).
2. Setiap request menyertakan `Authorization: Bearer <token>` otomatis.
3. Saat aplikasi mount, `AuthContext` panggil `/api/auth/me` — kalau OK rehydrate, kalau 401 clear & redirect ke `/login`.
4. Response 401 manapun → auto-clear token + event `auth:logout` → `AuthContext` logout.

## Data Flow

- **REST** untuk initial load (inspections, parts, dashboard summary, agents).
- **WebSocket singleton** ke `/ws` untuk event realtime (inspection / station / alert) — satu socket multiplex semua hook.
- **WebSocket frame** ke `/ws/frames` untuk JPEG binary per station.
- Tombol **Mulai/Hentikan Inspeksi** di `LiveTrackingPage` → `POST /api/agents/:stationId/command`.