# DimInspect Frontend

React + Vite dashboard untuk monitoring inspeksi dimensi: live video tile per station, kontrol start/stop agent, history, quality tracking, users, parts. Session persistence pakai JWT di `localStorage` + auto-rehydrate via `/api/auth/me`.

## Build

```bash
npm run build
```

## Docker

```bash
docker build -t diminspect-frontend .
docker run --rm -p 8080:8080 diminspect-frontend
```

## Routing

Frontend production selalu lewat nginx reverse proxy:

- REST: `/api/*`
- Realtime: `/ws`
- Frame stream: `/ws/frames`

Tidak ada build-time API/WS environment variable. Backend tidak diakses langsung dari browser.

## Default Credentials

Demo seed sudah di-hash bcrypt di DB:

| Username     | Password   | Role        |
|--------------|------------|-------------|
| `admin`      | `admin123` | admin       |
| `supervisor` | `super123` | supervisor  |
| `qc1`        | `qc123`    | qc          |
| `operator1`  | `op123`    | operator    |
| `vendor1`    | `ven123`   | vendor      |

## Auth Flow

1. `POST /api/auth/login` menyimpan JWT di `localStorage` (`diminspect_auth_token`).
2. Setiap request menyertakan `Authorization: Bearer <token>` otomatis.
3. Saat aplikasi mount, `AuthContext` panggil `/api/auth/me`; kalau OK rehydrate, kalau 401 clear dan redirect ke `/login`.
4. Response 401 manapun auto-clear token dan trigger event `auth:logout`.

## Data Flow

- **REST** untuk initial load: inspections, parts, dashboard summary, agents.
- **WebSocket singleton** ke `/ws` untuk event realtime.
- **WebSocket frame** ke `/ws/frames` untuk JPEG binary per station.
- Tombol inspeksi di `LiveTrackingPage` memanggil `POST /api/agents/:stationId/command`.
