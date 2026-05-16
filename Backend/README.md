# DimInspect Backend

Backend menyediakan REST API, WebSocket realtime, dan MQTT ingestion untuk agent inspeksi.

## Run local

```bash
npm install
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
docker run --rm -p 4000:4000 -e MQTT_ENABLED=false diminspect-backend
```

## Environment

```text
HOST=0.0.0.0
PORT=4000
STORAGE_DRIVER=json
DATA_FILE=./data/diminspect.json
MQTT_ENABLED=false
MQTT_URL=mqtt://localhost:1883
MQTT_TOPIC_PREFIX=diminspect
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
