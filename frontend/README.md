# DimInspect Frontend

Svelte 5 (runes) + Vite 6 SPA. Build output static di `dist/` dan diserve oleh nginx container.

## Run

```powershell
npm install
npm run dev
```

Untuk full app dengan backend/proxy:

```powershell
docker compose up --build
```

## Routes

- `/dashboard`
- `/live-tracking`
- `/history`
- `/quality-tracking`
- `/part-configuration`
- `/part-configuration/new`
- `/part-configuration/:id/edit`
- `/user-management`
- `/user-management/new`
- `/user-management/:id/edit`

## Notes

- API memakai relative path `/api/*`.
- Container nginx frontend mem-proxy `/api/*` ke `API_PROXY_PASS` agar browser production tetap same-origin.
- Data non-realtime memakai REST polling yang menyesuaikan visibility tab.
- Live Tracking membaca presence + bounding box realtime langsung dari broker EMQX via MQTT-over-WebSocket (lib `mqtt`); konfigurasi koneksi (URL WSS + kredensial subscribe-only) diambil dari `GET /api/realtime/mqtt`.
- Live video memakai Cloudflare Realtime/WebRTC lewat endpoint signaling backend.
- Favicon memakai logo yang sama dengan navbar.
- Frame thumbnail memakai signed URL dari backend jika R2 aktif.

## Validation

```powershell
npm run check
npm run build
```
