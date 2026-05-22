# DimInspect Frontend Svelte 5

Pure Svelte 5 (runes) + Vite 6 SPA. Tidak pakai SvelteKit. Deployed sebagai static asset di nginx.

## Dev

```powershell
npm install
npm run dev
```

Dev server di `http://localhost:5173`, akan proxy ke backend lokal di `http://localhost:3001` (dikonfigurasi via nginx atau Vite dev proxy bila perlu).

## Build

```powershell
npm run build
```

Output ke `dist/`. Pakai via Docker:

```powershell
docker build -t diminspect-frontend .
docker run -p 8080:8080 diminspect-frontend
```

## Catatan

- Kontrak API selaras Backend Rust terbaru (lihat `Backend/src/domain/types.rs`).
- Tidak ada shift/batch — sudah dihapus dari Backend.
- Frame inspeksi disimpan di Cloudflare R2 dengan signed URL TTL 24 jam; auto-refresh via `<img onerror>`.
