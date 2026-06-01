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
- Live data non-video memakai REST polling yang menyesuaikan visibility tab.
- Live video memakai Cloudflare Realtime/WebRTC lewat endpoint signaling backend.
- Favicon memakai logo yang sama dengan navbar.
- Frame thumbnail memakai signed URL dari backend jika R2 aktif.

## Validation

```powershell
npm run check
npm run build
```
