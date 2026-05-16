# DimInspect Frontend

React Vite dashboard untuk monitoring inspeksi dimensi, quality tracking, history, users, dan parts.

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
```

## Data flow

- REST untuk initial data.
- WebSocket untuk realtime update.
- Mock fallback aktif jika backend belum tersedia.