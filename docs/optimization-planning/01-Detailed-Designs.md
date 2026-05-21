# 01 — Detailed Designs (pixel-level)

> Companion to `00-PRD-DimInspect-Optimization.md`. Read that first for context.

This document gives concrete pixel-level layout, spacing, colors, motion, and copy decisions. Pixel values assume the Tailwind 4 token system already in use (`var(--card)`, `var(--border)`, etc., defined in `Frontend/src/styles/theme.css`).

Naming convention:
- "Token" = CSS variable from `theme.css`.
- "Spacing" uses Tailwind scale (4px grid): `gap-2 = 8px`, `gap-3 = 12px`, `gap-4 = 16px`, `gap-6 = 24px`.
- Border radius scale: `rounded-md = 6px`, `rounded-lg = 8px`, `rounded-xl = 12px`, `rounded-2xl = 16px`, `rounded-full = 9999px`.

---

## 1. Layout / sidebar / user menu / logout / dark-mode toggle

### 1.1 Sidebar (`Layout.tsx`) — minimal changes

Keep the existing `<aside>` sidebar geometry:
- Width: **256px** (`w-64`) desktop, full-width sheet on mobile (`-translate-x-full`).
- Background: `#0f172a` (slate-900) — keep, this is a brand element.
- Padding: header `px-5 py-5`, nav `px-3` with `space-y-1`.

**Remove from footer:** the inline logout button (lines 66–79). Replace with a clickable user trigger that opens a popover.

### 1.2 User trigger (sidebar footer)

```
+--------------------------------------------------------------+
| [Avatar 32px]  Hasbi                                ▼ 14px   |
|                Admin                                        |
+--------------------------------------------------------------+
```

Container:
- Element: `<button>` (whole row is clickable).
- Padding: `12px 16px`.
- Border-top: `1px solid rgba(255,255,255,0.1)`.
- Hover: `bg-white/5`.
- Avatar circle: 32×32, `rounded-full`, blue-500/30 bg, initial centered.
- Name: 14px, white, font-weight 500, truncate.
- Role: 11px, gray-400, truncate.
- Chevron: 14px, white/50, rotates 180° when popover open.

Aria: `aria-haspopup="menu" aria-expanded={open}`.

### 1.3 User popover

Positioning:
- Anchor: bottom-edge of the trigger.
- Offset: `top: -8px` (pop UP not down, since trigger is at the very bottom).
- Width: **280px** fixed.
- Padding: `8px` (popover padding).
- Background: `var(--card)`.
- Border: `1px solid var(--border)`.
- Shadow: `0 10px 24px rgba(0,0,0,0.18)`.
- Radius: `rounded-xl`.
- z-index: 60 (above mobile sidebar backdrop 30).

Content rows (top-down, gap-1 between groups):

1. **Identity block** (read-only, not a button):
   - Padding `12px`.
   - Name 14px font-weight 500.
   - `@username` 12px `text-muted-foreground`.
   - Role badge inline (existing roleBadge palette).

2. **Divider:** 1px `var(--border)`, margin-y 4px.

3. **Theme group label:** "Tampilan" — 11px uppercase tracking-wide `text-muted-foreground`, padding `4px 12px`.

4. **Theme radios** (3 rows, each 36px height):
   - Icon (16px) + label (14px) + check (16px, right-aligned, only when active).
   - Padding `8px 12px`.
   - Hover: `bg-accent`.
   - Selected: `text-foreground` (others `text-muted-foreground`).
   - Labels: "Sistem", "Terang", "Gelap".
   - Icons: `Monitor`, `Sun`, `Moon` (lucide).

5. **Shortcut hint row:** "Ctrl + Shift + L" 11px `text-muted-foreground` right-aligned, padding `4px 12px`.

6. **Divider.**

7. **Keluar** row:
   - Icon `LogOut` 16px, `text-red-600`.
   - Label "Keluar" 14px font-weight 500 `text-red-600`.
   - Padding `10px 12px`.
   - Hover: `bg-red-50` (light) / `bg-red-500/10` (dark).

Motion:
- Open: `opacity 0 → 1`, `translateY 4px → 0` in 120ms `ease-out`.
- Close: same, 80ms `ease-in`.
- Outside click → close. Esc → close + restore focus to trigger.

### 1.4 Header (top bar) — secondary access to user popover

The current `<header>` only houses the mobile hamburger. Add a right-side avatar trigger that opens the **same** popover. Keeps logout one click away on every screen, including mobile.

Header:
- Height: `h-14` (56px) — unchanged.
- Padding: `px-4`.
- Background: `var(--card)`.
- Border-bottom: `1px solid var(--border)`.
- Left: existing mobile hamburger (`lg:hidden`).
- Center: empty (flex-1).
- Right: avatar trigger 32×32, plus a notification dot if any phase is `calibrating` and user is supervisor (small flourish, optional v1.1).

### 1.5 Theme provider implementation

```tsx
// Frontend/src/app/context/ThemeContext.tsx
type Theme = 'light' | 'dark' | 'system';
const KEY = 'diminspect_theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem(KEY) as Theme) ?? 'system'
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (theme === 'system') media.addEventListener('change', apply);
    localStorage.setItem(KEY, theme);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setTheme((t) => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}
```

Wrap `<AuthProvider>` in `App.tsx`.

### 1.6 Dark-mode token additions

`theme.css` already defines a complete `.dark` palette. Two adjustments required for the new dashboard charts:

```css
.dark {
  --chart-ok: oklch(0.74 0.16 145);     /* green that survives dark bg */
  --chart-ng: oklch(0.68 0.20 25);      /* red */
  --chart-amber: oklch(0.78 0.16 75);
  --chart-neutral: oklch(0.55 0 0);
}
:root {
  --chart-ok: #22c55e;
  --chart-ng: #ef4444;
  --chart-amber: #f59e0b;
  --chart-neutral: #64748b;
}
```

Recharts components read these via `stroke="var(--chart-ok)"` — switch hard-coded colors (`#22c55e`, `#ef4444`) in `DashboardPage.tsx` to these tokens.

---

## 2. Live Tracking redesign

### 2.1 Page header (replaces today's H1 strip)

```
+-----------------------------------------------------------------------+
| Live Tracking                                  [Multi | Focus | Wall] |
| Pilih part, lalu mulai inspeksi.               [● 2 Online · 1 Aktif] |
+-----------------------------------------------------------------------+
```

- H1: 24px font-weight 500.
- Subtitle: 14px `text-muted-foreground`.
- Right: segmented control (mode switch) + status pills.
- Segmented control: 32px height, `bg-muted`, `rounded-lg`, 3 segments each `px-3 py-1.5 text-xs`. Active = `bg-card text-foreground` with `shadow-sm`.

### 2.2 Multi mode (default for supervisor/qc/admin)

Grid: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` with `gap-4`.
Each tile:
- Aspect `aspect-video` (16:9), max-width 100%, **min-height 280px** (today's is too small at ~200px).
- Border `1px var(--border)`, `rounded-xl`, `overflow-hidden`.
- Header strip 40px: station name + phase badge + expand-to-Focus button (top-right 32×32).
- Body: camera frame (or placeholder).
- Footer strip 56px: select (part) + Start button OR 3-button row (Capture / Kalibrasi / Stop) — same as today, restyled smaller.

### 2.3 Focus mode (default for operator role)

Two-column on desktop:
```
+--------------------------------+----------------------+
| [Station name]   [phase pill]  | Shift KPIs (2x2)     |
|                                |                       |
|  ┌──────────────────────────┐  | Dim 1 (sparkline)    |
|  │                          │  | Dim 2 (sparkline)    |
|  │      CAMERA              │  | Dim 3 (sparkline)    |
|  │   (max-h calc(100vh-200))│  |                       |
|  │                          │  | Last 5 inspections   |
|  └──────────────────────────┘  |                       |
|     [● Capture]                |                       |
+--------------------------------+----------------------+
```

Grid: `grid-cols-[1fr_320px]` desktop, `grid-cols-1` mobile (KPI panel collapses to top).
Gap: `gap-4`.

#### 2.3.1 Camera column

- Wrapper: `flex flex-col gap-3`.
- Top bar: 32px tall, flex-between.
  - Left: station name 16px font-weight 500.
  - Right: 3 chips (FPS · Online · Phase) in a `gap-2` cluster + station picker dropdown (40×24 select if multi-station session).
- Camera frame: `aspect-video`, `bg-black`, `rounded-xl`, `overflow-hidden`, position relative.
  - Inside, `<img>` (`w-full h-full object-contain`).
  - Above, `<canvas>` overlay for bboxes (`absolute inset-0 pointer-events-auto`).
  - Bottom-center: **Capture button**:
    - 56×56 circle, `bg-blue-600` hover `bg-blue-700`, shadow `shadow-lg`, `text-white`.
    - Icon `Camera` 24px.
    - Position: `absolute bottom-4 left-1/2 -translate-x-1/2`.
    - Disabled state: opacity 50%, cursor not-allowed; tooltip explains why.
- Expand button: top-right of camera, 32×32, `bg-black/40 text-white rounded-md`. Maximize icon. On click, toggle fullscreen API.

#### 2.3.2 Stats column (320px)

Components top-down with `space-y-3`:

**A. Shift KPIs (4 mini cards in 2×2):**
- Card: `bg-card border border-border rounded-lg p-3`.
- Label: 11px `text-muted-foreground`.
- Value: 20px font-weight 500. Color: NG = red, %NG = traffic-light by threshold.
- Click any card → opens a modal with that metric's 7-day chart.

**B. Per-dimension cards (one per dimension in active part):**
- Header row 24px: dimension name (12px) + nominal value (11px muted, right-aligned).
- Sparkline 32px height, full-width.
- Bottom row: 3 micro-stats — `Avg`, `σ`, `Last` — each 11px label + 12px value, evenly spaced.
- Highlight: when a bbox is selected, this card highlights with `ring-2 ring-blue-500/30` and the sparkline restricts to the selected detection's history.

**C. Recent inspections (5 rows):**
- Each row: 48px, padding `12px`.
- Layout: status dot (8px) + part name (13px font-weight 500) + delta (12px muted, e.g. `+0.03 mm`) + timestamp (11px muted, right).
- Hover: `bg-accent/40 cursor-pointer` → expands inline with dim breakdown.

### 2.4 Wall mode

Same grid as Multi, but no chrome (no headers, no controls). Each tile fills its grid cell, and the whole page background goes black. Designed for a wall-mounted display.

Activated by `?mode=wall` query, hidden in normal navigation.

### 2.5 Bounding box overlay — spec

- Canvas resolution: matches displayed `<img>` rect (use `getBoundingClientRect`).
- Re-render trigger: each new `inspection.preview` event for this station.
- Per detection:
  - Stroke: 2px (3px on hover, 3px when selected).
  - Stroke color: `--chart-ok` if status OK, `--chart-ng` if NG.
  - Fill: none, `rgba(color, 0.12)` on hover, `rgba(color, 0.18)` selected.
  - Corner radius: 6px.
  - Label chip top-left of bbox: 11px text on `rgba(0,0,0,0.6)` 4px padding 4px radius. Content e.g. `Ø 4.95 mm  ↑ +0.03`.
- Click handling: hit-test point-in-rect; emit `setSelectedDetectionId(d.id)`. Click outside any bbox: clear selection.

### 2.6 Capture button states & undo banner

States:
- `idle`: blue solid, enabled.
- `pressed`: 200ms white-overlay flash on camera image.
- `cooldown`: disabled 500ms (gray, no pointer events).
- `disabled` (calibrating/idle): gray, tooltip per cause.

Undo banner (appears 0ms after press):
- Position `absolute bottom-20 left-1/2 -translate-x-1/2` (above the Capture button).
- Container `flex items-center gap-3 px-4 py-2.5 rounded-full bg-gray-900/90 text-white`.
- Inner: `<CheckCircle2>` icon 16px green + "Tersimpan" (14px) + dot `·` 14px white/60 + "Batal" (12px underline, button).
- Auto-dismiss 1500ms (CSS animation `opacity 1 → 0` over last 200ms).
- Click "Batal" → fires `DELETE /api/inspections/:id` (soft-delete) and toast "Dibatalkan".

---

## 3. UX writing audit

### 3.1 Rules

1. **No "backend" / "frontend" in operator-visible copy.** Operators don't have those mental models.
2. **Buttons = imperative verbs**, no `-ing`. "Mulai", "Simpan", "Ulangi" — not "Memulai", "Menyimpan".
3. **Loading text** = single word + ellipsis. "Memuat…", "Masuk…". Never "Memuat data dari backend…".
4. **Empty states** = one sentence. Never two. No advice to "Run agent" — that's not what an operator can do.
5. **Inline metadata separators**: use middot `·` (U+00B7) between fields, not bullet `•`. Bullet stays for vertical lists.
6. **Localized dates**: `id-ID` with explicit `{ hour: '2-digit', minute: '2-digit' }` for list items, `{ hour:'2-digit', minute:'2-digit', second:'2-digit' }` only for detail timestamps.
7. **Don't echo the heading.** If H1 says "Dashboard Monitoring", subtitle must not also say "Overview". Pick one.
8. **Title case avoided** in Indonesian copy — use sentence case. Currently OK in most places.
9. **Status semantics:** OK = green, NG = red, transitional state = amber, neutral = gray. No exceptions.
10. **Confirm-destructive copy**: include the affected name. E.g. "Hapus user 'Hasbi'?" not "Yakin hapus?".

### 3.2 String change table (full audit)

| Page | Selector / context | Before | After |
|---|---|---|---|
| Sidebar | nav item | "Riwayat Inspeksi" | "Riwayat" |
| Sidebar | nav item | "Manajemen User" | "Pengguna" |
| Sidebar | nav item | "Konfigurasi Part" | "Part" |
| Sidebar | nav item | "Quality Tracking" | "Permintaan Part" |
| Sidebar footer | logout label | "Keluar" | (moved to popover, same word) |
| Header | (none, empty) | — | (avatar trigger added) |
| Dashboard | H1 | "Dashboard Monitoring" | "Dashboard" |
| Dashboard | subtitle | "Overview kualitas inspeksi dimensi real-time" | "Ringkasan kualitas hari ini." |
| Dashboard | empty state | "Belum ada data inspeksi. Jalankan Agent untuk mengisi dashboard." | "Belum ada inspeksi." |
| Dashboard | chart title | "Tren Inspeksi Harian" | "Tren harian" |
| Dashboard | chart title | "NG per Tipe Part" | "NG per part" |
| Dashboard | chart title | "Part NG Terbaru" | "NG terbaru" |
| Live Tracking | H1 | "Live Tracking" | (unchanged) |
| Live Tracking | subtitle | "Pilih part, mulai inspeksi, dan letakkan part di bawah kamera — sistem otomatis mencatat 1 part = 1 data." | "Pilih part, lalu mulai inspeksi." |
| Live Tracking | empty cams placeholder | "Belum ada agent yang terhubung." + "Jalankan agent di mesin local untuk mulai streaming." | "Belum ada stasiun terhubung." |
| Live Tracking | cam empty hint | "Idle — pilih part lalu klik Mulai" | "Idle" |
| Live Tracking | cam waiting | "Menunggu frame..." | "Menyambung…" |
| Live Tracking | toast | "Capture manual: station-1" | "Tersimpan" |
| Live Tracking | toast prefix | "Mulai inspeksi: station-1" | "Mulai" |
| Live Tracking | toast prefix | "Recalibrate: station-1" | "Kalibrasi" |
| Live Tracking | toast prefix | "Berhenti: station-1" | "Berhenti" |
| Live Tracking | phase label | "Kalibrasi background" | "Kalibrasi" |
| Live Tracking | phase label | "Siap — masukkan part" | "Siap" |
| Live Tracking | phase label | "Mendeteksi part..." | "Deteksi…" |
| Live Tracking | phase label | "Tercatat — angkat part" | "Tercatat" |
| Live Tracking | event item | "Confidence: 95% • Auto" | "95% · Auto" |
| Live Tracking | event panel title | "Stream Event Inspeksi" | "Inspeksi terakhir" |
| Live Tracking | tile activePart fallback | `(modelVersion ?? 'belum ada part')` | `'Pilih part'` |
| History | H1 | "Riwayat Inspeksi" | "Riwayat" |
| History | subtitle | "Traceability data hasil inspeksi" | "Riwayat hasil inspeksi." |
| History | search placeholder | "Cari ID, part, batch, operator..." | "Cari…" |
| History | "Semua Status" | (unchanged) | (unchanged) |
| History | empty hint | "Belum ada data inspeksi dari backend." | "Belum ada inspeksi." |
| History | filter mismatch | "Tidak ada data yang cocok dengan filter." | "Tidak ada hasil." |
| History | loading | "Memuat riwayat inspeksi dari backend..." | "Memuat…" |
| History | export button | "Export CSV" | "Ekspor CSV" |
| Parts | H1 | "Konfigurasi Tipe Part" | "Part" |
| Parts | subtitle | "Spesifikasi dimensi per tipe part (read-only). Kelola via seed data Backend." | "Spesifikasi dimensi tiap part." |
| Parts | loading | "Memuat konfigurasi part dari backend..." | "Memuat…" |
| Parts | empty | "Belum ada konfigurasi part dari backend." | "Belum ada part." |
| Users | H1 | "Manajemen User" | "Pengguna" |
| Users | subtitle | "Daftar user (read-only). Kelola via seed data Backend." | "Daftar pengguna." |
| Users | loading | "Memuat user dari backend..." | "Memuat…" |
| Quality | H1 | "Quality Tracking" | "Permintaan Part" |
| Quality | subtitle | "Monitoring NG ratio harian per part & manajemen permintaan part ke vendor" | "Permintaan part pengganti ke vendor." |
| Quality | loading | "Memuat quality records dari backend..." | "Memuat…" |
| Quality | toast | "Status berhasil diubah ke \"<label>\"" | "Status: <label>" |
| Quality | action | "Kirim Request ke Vendor" | "Kirim ke vendor" |
| Quality | action | "Konfirmasi Diterima" | "Tandai diterima" |
| Quality | action | "Proses Permintaan" | "Mulai proses" |
| Quality | action | "Tandai Dikirim" | "Tandai dikirim" |
| Quality | column | "Total Scan Hari Ini" | "Scan hari ini" |
| Quality | column | "Total NG Hari Ini" | "NG hari ini" |
| Quality | column | "Rata-rata NG Rate" | "NG rate" |
| Quality | column | "Request Pending" | "Permintaan terbuka" |
| Login | H1 | "DimInspect" | (unchanged) |
| Login | subtitle | "Sistem Monitoring Kualitas Inspeksi Dimensi" | "Quality monitoring inspeksi dimensi." |
| Login | form H2 | "Masuk ke Sistem" | "Masuk" |
| Login | username placeholder | "Masukkan username" | "Username" |
| Login | password placeholder | "Masukkan password" | "Password" |
| Login | submit (loading) | "Memproses..." | "Masuk…" |
| Login | error | "Username atau password salah" | (unchanged) |
| Generic | retry | "Coba lagi" | "Ulangi" |
| Generic | fallback error | "Backend tidak tersedia" | "Tidak terhubung" |
| Generic | unauthenticated | "Memuat sesi..." | "Memuat…" |

### 3.3 Tooltip / aria copy

Action buttons need tooltips (currently some have `title="..."`, others don't):

| Button | Tooltip |
|---|---|
| Capture | "Simpan satu inspeksi (Spasi)" |
| Kalibrasi | "Kalibrasi ulang (kamera harus kosong)" |
| Stop | "Hentikan stream" |
| Expand camera | "Perbesar (F)" |
| Mode segmented control | "Tampilan: Multi / Fokus / Wall" |
| Theme radios | "Tema: Sistem / Terang / Gelap (Ctrl+Shift+L)" |

Add `aria-label` to all icon-only buttons (`Menu`, `LogOut`, `Eye/EyeOff`, etc.).

---

## 4. Dashboard layout & charts (detailed)

### 4.1 Grid structure

```
+----------------------------------------------------------+
| H1   Filter pills [7d|14d|30d]   (right)                 |
| sub                                                       |
+----------------------------------------------------------+
| KPI 1  KPI 2  KPI 3  KPI 4  KPI 5    (grid 5 cols equal) |
+----------------------------------------------------------+
| Line: Tren harian (full width, h-280)                    |
+----------------------------------------------------------+
| Pie: OK/NG  |  Bar: NG per part   (2 cols, h-260 each)   |
+----------------------------------------------------------+
| Bar: NG per dimensi (full width, h-260)                  |
+----------------------------------------------------------+
| Bar: NG per shift   |  Bar: NG per station   (2 cols)    |
+----------------------------------------------------------+
| Recent NG table (full width, 8 rows)                     |
+----------------------------------------------------------+
```

Grid container: `space-y-4`.
KPI strip: `grid grid-cols-2 lg:grid-cols-5 gap-4`. Each card `bg-card border border-border rounded-xl p-4`.
Two-up rows: `grid lg:grid-cols-2 gap-4`.

### 4.2 KPI cards (5)

| # | Label | Value source | Color accent |
|---|---|---|---|
| 1 | Total inspeksi | `total` | blue |
| 2 | OK | `ok` | green |
| 3 | NG | `ng` | red |
| 4 | %NG | `ngRate.toFixed(1)` | amber (threshold-graded) |
| 5 | Stasiun aktif | `activeStationCount / stationCount` | slate |

Card spec (unchanged from today): padding 16px, 8px gap between label and value, icon chip 32×32 top-right.

### 4.3 Chart styling defaults (all)

- Container: `ResponsiveContainer` width 100% height (per chart).
- Grid: `CartesianGrid strokeDasharray="3 3" stroke="var(--border)"`.
- Axis text: 11px tick, `var(--muted-foreground)`.
- Tooltip: `bg-card border border-border rounded-md text-xs p-2 shadow-sm`.
- Series colors: from `--chart-ok`, `--chart-ng`, `--chart-amber`, `--chart-neutral`.

### 4.4 Line — Tren harian

- Two `<Line>` series (OK + NG).
- `strokeWidth=2`, `dot={false}`, `activeDot={r:3}`.
- X-axis: `dataKey="date"`, formatter strips year (`v => v.slice(5)`).
- Y-axis: auto.
- Height: **280px**.

### 4.5 Pie — OK/NG distribusi

- Recharts `<PieChart>` with 2 cells.
- `innerRadius=55`, `outerRadius=85` (donut).
- Center label: `%NG` value, 24px font-weight 500.
- Legend bottom 12px.
- Height: **260px**.

### 4.6 Bar — NG per part

- Top 8 by NG desc. Server provides `[{ name, ok, ng }]`.
- Stacked `<Bar>` like today, but radius only on the top stack (NG): `radius={[4,4,0,0]}`.
- Height: **260px**.

### 4.7 Bar — NG per dimensi (new)

- Horizontal bars (`layout="vertical"`) — dimension names often long.
- Server returns `[{ dimension, ng }]` from a SQL query that unrolls `measurements jsonb` (Postgres `jsonb_array_elements`).
- Color: solid `--chart-ng`.
- Height: **260px**.

### 4.8 Bar — NG per shift

- Stacked bar across the 3 shifts (A/B/C), one bar per day for last 7 days.
- Series: `ok`, `ng` stacked. Two-toned per shift via color per series.
- Tooltip shows shift breakdown.
- Height: **260px**.

### 4.9 Bar — NG per station

- One bar per station, value = NG count last 7 days. Sorted desc.
- Height: **260px**.

### 4.10 Recent NG table (8 rows)

Columns:
- ID (mono, 11px)
- Part (name + code)
- Batch (small)
- Dimensi NG (badge list)
- Station (12px)
- Operator (12px)
- Waktu (right, 11px)

### 4.11 Server endpoint shape

```ts
GET /api/dashboard/insights?range=14d
→ {
  range: '14d',
  kpis: {
    total: number, ok: number, ng: number, ngRate: number,
    stationCount: number, activeStationCount: number,
  },
  trend: [{ date: string, ok: number, ng: number }],
  pie: { ok: number, ng: number },
  byPart: [{ partCode: string, partName: string, ok: number, ng: number }],
  byDimension: [{ dimension: string, ng: number }],
  byShift: [{ date: string, A: number, B: number, C: number }],
  byStation: [{ stationId: string, ng: number }],
  recentNg: InspectionResult[8],
}
```

All eight blocks come from one server transaction. Frontend stops doing client-side aggregation.

---

## 5. Batch & shift administration UI

### 5.1 Settings hub (`/settings`, reusing existing admin navigation)

Replaces current isolated `/users` and `/parts` routes. This satisfies the requirement that shift schedule is configurable **without adding another menu**. The sidebar keeps one admin entry labeled "Pengaturan"; inside it, tabs expose:

1. **Pengguna** — current `/users` content.
2. **Part** — current `/parts` content (moved here).
3. **Shift** — new.
4. **Batch** — new (mostly read-only, lists open/closed batches).

Layout: `grid-cols-[200px_1fr] gap-6`, left rail = vertical tabs (40px each, active = `bg-accent text-foreground`).

Visible to: `admin` always; `supervisor` for Shift + Batch tabs only.

### 5.2 Shift tab

- List view: table of shift schedules.
- Columns: Name (A/B/C) · Start · End · Timezone · Actions.
- "Tambah shift" button top-right.
- Validation banner if 24h not fully covered: "Jadwal belum menutup 24 jam (gap: 02:00–06:00)".

Editor (modal): two time pickers (HH:MM) + name + timezone dropdown (default Asia/Jakarta).

### 5.3 Batch tab

- Two sections:
  - **Terbuka** — table of currently open batches across all stations.
    - Columns: Batch · Station · Part · Operator · Dibuka · Total scan · Tindakan (`Tutup batch` button).
  - **Riwayat** — closed batches, paginated.

### 5.4 Live Tracking — batch picker

In Focus mode header, between station name and phase pill:

```
[Batch: BX-2026-05-21-001 ▼]  [● Tutup batch]
```

Click dropdown → opens a small popover (280px) with:
- "Pilih batch yang aktif"
- Search input
- Recent batches list
- "Buka batch baru" button at bottom

"Buka batch baru" opens a modal:
- Field: Batch number (default suggestion `BX-{YYYYMMDD}-{seq}`, editable).
- Field: Part (pre-filled from selected part).
- Field: Target qty (optional, integer).
- Field: Notes (optional).
- Submit → POST `/api/batches { stationId, partCode, batchNo, targetQuantity, notes }`. Backend rejects if station already has an open batch.

Inspections captured while batch is open get `batch_no = batchNo`. Inspections captured between batches get `batch_no = NULL` and the History column shows an "Ad-hoc" badge. The old auto-generated `B{YYYYMMDD}` batch number is removed so fake batch data is never shown as if it were administered.

### 5.5 Frontend impact summary

New hooks:
- `useShiftSchedules`
- `useBatches({ stationId?, status? })`
- `useOpenBatch(stationId)`

New API endpoints:
- `GET/POST/PATCH/DELETE /api/shifts`
- `GET/POST /api/batches`, `PATCH /api/batches/:id/close`
- `GET /api/agents/:stationId/open-batch`

---

## 6. Capture flow — sequence diagram

```
Operator              Frontend                Backend               Agent
  |  click "Capture"   |                       |                     |
  |------------------->|                       |                     |
  |                    | POST /api/agents/.../command {capture}      |
  |                    |---------------------->|                     |
  |                    |                       | send {capture} WS   |
  |                    |                       |-------------------->|
  |                    |                       |                     | freeze current detection result
  |                    |                       |                     | compute detections[]
  |                    |                       |                     | emit inspection.created
  |                    |                       |<--------------------|
  |                    |                       | persist metadata + detections only
  |                    |                       | publish /ws         |
  |                    |   /ws event           |                     |
  |                    |<----------------------|                     |
  |     undo banner    |                       |                     |
  |<-------------------|                       |                     |
  |  click "Batal" (within 1.5s)               |                     |
  |------------------->| DELETE /api/inspections/:id (soft)          |
  |                    |---------------------->|                     |
  |                    |                       | UPDATE deleted_at   |
  |                    |                       |  (soft-delete audit)|
```

No camera frame is stored in this flow. The "freeze" is a UI state based on the latest streamed frame/detection, not a backend retention feature.

---

## 7. Accessibility & motion

- All interactive elements: focus ring `outline-ring/50` (already in `theme.css` base).
- Reduced motion (`@media (prefers-reduced-motion: reduce)`): disable framer-style transitions, replace with instant state changes.
- Color contrast: all text/icon pairs ≥ WCAG AA in both light and dark themes (verify with `oklch` luminance).
- Keyboard:
  - Sidebar nav: arrow keys move focus between links.
  - User popover: Esc closes.
  - Capture button: Spacebar triggers when focused; "F" toggles fullscreen.

---

*End of detailed designs. See `02-Edge-Cases-and-Mitigations.md` for the failure-mode matrix.*
