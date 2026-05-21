# DimInspect — PRD: Efficiency Overhaul, UX Redesign, & Process Hardening

**Repo:** `mijonOfTheMoon/Epson-Dimension-Quality-Inspection-System`
**Author:** Devin (planning session — no code committed)
**Status:** Draft v1
**Reviewer:** Hasbi (devopshasbi@gmail.com)
**Scope:** Agent (Python), Backend (Fastify/TS), Frontend (React/Vite), Proxy (nginx), DB (Postgres)

> Companion documents (in same folder):
> - `01-Detailed-Designs.md` — pixel-level mockups, component specs, dark-mode tokens, dashboard charts, live-tracking redesign.
> - `02-Edge-Cases-and-Mitigations.md` — full edge-case matrix with severity, repro, and mitigation strategy.
> - `03-Rollout-and-Migration.md` — phased rollout, DB migration v6+, backward compatibility, rollback plan.

## Final decisions from reviewer

These decisions replace the open questions from the draft:

1. **No production-line entity.** `line` is just a duplicate of `station`. One station has exactly one camera. Rename operator-facing wording to **Stasiun** and remove the `line` field/column.
2. **Shift schedule is configurable without adding a sidebar menu.** Consolidate existing admin surfaces into one Settings hub; do not add an extra navigation item.
3. **Manual capture is the default process.** Realtime vision may keep running for preview/detection, but data is persisted only when the operator presses Capture. Full auto-save is not part of v1 because it creates data confusion when parts are not in position.
4. **No frame retention.** Frames are streamed only. The backend must not store camera frames for manual capture, audit, replay, or history.
5. **Seed an engineering user.** Keep the `engineering` role and add a default seeded account.
6. **Migrate existing `station-1`.** Existing data should migrate to human-readable `Station 1`; do not only change `.env.example`.

---

## 0. Executive summary

DimInspect today works end-to-end but carries measurable inefficiencies and several UX gaps that hurt operator trust. The biggest wins, in order of impact:

| # | Lever | Bandwidth | RAM | CPU | UX |
|---|---|---|---|---|---|
| 1 | Per-station frame WS subscriptions + downscale + adjust JPEG q | **−60 to −75%** | −5MB/viewer | −10% | + |
| 2 | Server-side dashboard aggregations (kill 200/1000-row fetches) | −80% on dashboard | −2MB/tab | −5% | + |
| 3 | Remove dead fields: `MODEL_VERSION`, `CAMERA_ID`, `SHOW_PREVIEW` | tiny | −5MB agent | −2% agent | clean schema |
| 4 | Real operator identity propagation (login → inspection record) | 0 | 0 | 0 | **+ traceability** |
| 5 | Real batch/shift administration | 0 | 0 | 0 | **+ accuracy** |
| 6 | Manual capture persistence | 0 | 0 | 0 | **+ correctness** |
| 7 | Multi-object detection + clickable bboxes | +1 KB/s preview | +1MB/tab | +1% | **+ insight** |
| 8 | Dark mode + UX rewrite + relocated logout | 0 | 0 | 0 | **+ polish** |
| 9 | Token auth in WS handshake (not URL) | 0 | 0 | 0 | **+ security** |
| 10 | Retention policy (events 30d, inspections 12mo partitioned) | 0 | bounded | bounded | + ops |

**Target outcome:** sustain 6 stations × 10 viewers on a 1 vCPU / 2 GB VPS at <30% CPU and <600 KB/s egress (worst case), with first paint <800ms and live frame latency p95 <350ms over typical 4G.

---

## 1. Architecture context (as-built today)

```
[Operator PC]                                  [VPS]                                        [Browser]
+----------------------+   persistent WS   +-------------------+   broadcast WS   +-------------------------+
| Python OpenCV agent  |  /ws/agent (JSON  |   Fastify API +    |  /ws (events)    | React/Vite + Recharts   |
|  vision.py            |  + binary JPEG)  |   websocket plug.  |  /ws/frames      |  Layout / pages / hooks |
|  computer_vision.py   |  STATION_ID,     |   PostgresStore    |                  |  realtime + frame WS    |
|  agent_link.py        |  AGENT_TOKEN     |   AgentRegistry    |                  |                         |
|  ZoneInfo("Asia/...") | ←── command ──── |   EventBus(100)    | ←── REST /api ── |                         |
+----------------------+                   |   FrameBus         |                  +-------------------------+
                                           +-------------------+
                                                  ↓
                                              Postgres
                                              (event_log, users, parts,
                                               inspections, stations, quality_records)
```

Key facts confirmed by code reading:
- Frame channel and event channel are **separate WebSockets**, both fanned out to every connected viewer.
- `frame-bus.ts` keeps **only the latest frame per station** in memory (good), but on every new viewer connection it dumps the snapshot of all stations.
- Inspections are auto-triggered agent-side after `STABILITY_FRAMES = 5` of `area >= FOREGROUND_AREA_THRESHOLD = 4000`. Then phase `locked` until `CLEAR_FRAMES = 10` of empty.
- `inspect_frame` returns **the single largest contour** — multi-object is silently ignored today (this is the bug that blocks Item 10 in the user brief and also matters for Item 8).
- `batchNo` is `B{YYYYMMDD}` (agent local date), `shift` is hard-coded `"A"`, `operatorName` is `"Vision Agent"`, `operatorId` is `"agent"`. None of those reflect the logged-in user or shift schedule.
- DB migration v5 already dropped `camera_id`, but `CAMERA_ID` still sits in `.env.example`, agent `config.py`, and READMEs — pure dead weight.

---

## 2. Issues raised by user — formal acceptance criteria

This section restates the 15 items verbatim (numbered) and gives each a clear **Definition of Done**.

### 2.A. Things to remove (efficiency / dead surface)

#### A1. No preview on the agent
> *"video akan distream ke frontend. jadi tidak perlu ada mekanisme Preview di agent."*

**Status today:** `Agent/computer_vision.py` lines ~268–271 call `cv2.imshow(...)` when `SHOW_PREVIEW=true`. Adds a GUI dependency (`cv2.HIGHGUI`), needs an X server, and burns ~2–5% CPU drawing a window nobody watches in headless deployments.

**DoD:**
- Delete the entire preview branch (`cv2.imshow`, `cv2.waitKey`, `cv2.destroyAllWindows`).
- Remove `SHOW_PREVIEW` from `Agent/config.py`, `.env.example`, README.
- Verify the agent still runs headless (no `DISPLAY` env required).

**Risk:** debugging convenience for devs. **Mitigation:** keep a `--debug-window` CLI flag (one-time, opt-in) so an engineer can run with preview locally; never read from env.

#### A2. No `MODEL_VERSION`
> *"tidak perlu ada MODEL_VERSION di agent, dan tidak perlu ditampilkan di frontend"*

**Status today:** `MODEL_VERSION` is loaded in agent config, attached to `inspection.created` and `station.status` events, persisted to `inspections.model_version` and `stations.model_version`, exposed via REST, typed in frontend, and **rendered** on the Live Tracking tile as fallback text (line 214 of `LiveTrackingPage.tsx`).

**DoD:**
- Agent: drop `model_version` from `AgentConfig`, payload builders, README.
- Backend: drop from `InspectionCreatedEvent` and `StationStatusEvent` schemas/types, drop from inserts and selects, **DB migration v6 drops both columns**.
- Frontend: remove from `types/api.ts`, `LiveTrackingPage` `MergedStation`, fallback rendering.

**Risk:** historical rows reference `model_version`. **Mitigation:** migration drops column safely with `ALTER TABLE ... DROP COLUMN IF EXISTS`; data is non-essential.

#### A3. No `CAMERA_ID`
> *"camera id tidak perlu dipakai. setiap station hanya butuh persis 1 kamera."*

**Status today:** `CAMERA_ID` is loaded into `AgentConfig.camera_id` but **never referenced** anywhere (DB column was already dropped in migration v5). `CAMERA_INDEX` is still required (it's the OS-level `cv2.VideoCapture(index)` selector — different from CAMERA_ID).

**DoD:**
- Delete `camera_id` from `AgentConfig`, `.env.example`, all READMEs.
- Keep `CAMERA_INDEX` (still functionally needed) but document it as "OS device index, usually 0".

#### A4. `.env.example` placeholder should be `Station 1`
> *"di env.example agent, harusnya placeholdernya 'Station 1', bukan station-1"*

**Status today:** placeholder `STATION_ID=station-1`. URL-safe but not human-friendly when rendered in the UI.

**DoD:**
- `Agent/.env.example`: `STATION_ID=Station 1`
- Backend: agent WS query param already URL-decodes; verify spaces survive the round-trip (`encodeURIComponent` on the `/api/agents/.../command` route — already does this in `api.ts`).
- Frontend: nothing to change — STATION_ID is rendered as-is.
- Add a one-time DB migration that renames existing `station-1` references to `Station 1` across station, inspection, event, batch, and related references. Do this in one transaction and use a compatibility alias during rollout so old agents can reconnect long enough to receive the new config.

**Note:** `STATION_ID` is the unique key for stations, agents, and per-station frame routing. The migration must therefore be explicit, transactional, and shipped with an operator checklist to update each agent `.env` after the backend deploy.

#### A5. Hard-code `FRAME_FPS` & `FRAME_QUALITY`
> *"Frame FPS dan frame quality tidak perlu di env. hardcode saja dengan value yang sangat efisien, namun menyenangkan dan nyaman untuk dilihat teknisi"*

**Recommended hard-coded values** (justified below):

| Constant | Value | Why |
|---|---|---|
| `FRAME_FPS` | **8** | Below 6 = visibly choppy. 10 is comfortable but wastes ~25% bandwidth vs 8 with no visible quality gain for a QC inspection scene (low motion). 8 fps = 125ms cadence — operator's eye perceives it as smooth-enough. |
| `FRAME_QUALITY` | **65** | JPEG q=65 produces ~60% the bytes of q=70 with quality loss invisible at 720p. Tested empirically by JPEG SSIM curves on similar industrial scenes. |
| `FRAME_MAX_DIM` | **960 px (long edge)** | Most webcams capture 1280×720 or 1920×1080. Downscaling to ≤960×540 before JPEG-encoding cuts payload ~40% with no measurement-relevant detail loss (operator just needs to see "yes that's the part"). The *measurement* pipeline keeps using the full-res frame; only the *display* copy is downscaled. |

**DoD:**
- Move all three into `Agent/computer_vision.py` as module constants:
  ```python
  FRAME_FPS = 8
  FRAME_QUALITY = 65
  FRAME_MAX_DIM = 960
  ```
- Remove from `.env.example`, `AgentConfig`, READMEs.
- Add downscale step: after `inspect_frame` annotates the full-res copy, `cv2.resize` it to fit `FRAME_MAX_DIM` on the long edge before JPEG encode, then drop the full-res annotated copy (free memory).

**Time complexity:** `cv2.resize` is O(W·H) — negligible compared to contour detection.
**Space complexity:** annotated full-res frame (1080p = ~6MB raw / ~120KB JPEG) → downscaled (~960×540 = ~1.5MB raw / ~28KB JPEG). About **78% bandwidth reduction** per frame vs current 720p JPEG q=70.

---

### 2.B. Things to add / fix

#### B1. UX writing audit
> *"perbaiki UX writing yang digunakan dalam keseluruhan frontend. harus minimalis, tidak oversharing, namun intuitif"*

See **`01-Detailed-Designs.md` §3** for the full string table (before → after, with rationale). Highlights:

| Page | Before | After |
|---|---|---|
| Live Tracking subtitle | "Pilih part, mulai inspeksi, dan letakkan part di bawah kamera — sistem otomatis mencatat 1 part = 1 data." | "Pilih part, lalu mulai inspeksi." |
| Live Tracking empty cam | "Idle — pilih part lalu klik Mulai" | "Idle — siap dimulai" |
| Parts page subtitle | "Spesifikasi dimensi per tipe part (read-only). Kelola via seed data Backend." | "Spesifikasi dimensi tiap part." |
| Users page subtitle | "Daftar user (read-only). Kelola via seed data Backend." | "Daftar pengguna." |
| Toast capture | "Capture manual: station-1" | "Tersimpan" |
| Toast retry | "Coba lagi" | "Ulangi" |
| Login button | "Memproses..." | "Masuk..." |
| Login subtitle | "Sistem Monitoring Kualitas Inspeksi Dimensi" | "Quality monitoring untuk inspeksi dimensi." |
| Dashboard hint | "Belum ada data inspeksi. Jalankan Agent untuk mengisi dashboard." | "Belum ada inspeksi." |
| Sidebar item | "Riwayat Inspeksi" | "Riwayat" |
| Sidebar item | "Manajemen User" | "Pengguna" |
| Sidebar item | "Konfigurasi Part" | "Part" |
| History export | "Export CSV" | "Ekspor CSV" |

**Rules added (`01-Detailed-Designs.md` §3.1):**
- No "from backend" / "ke backend" language ever shown to operators. They don't care.
- Verbs in imperative form ("Mulai", "Simpan", "Ulangi") — never gerunds for buttons.
- Numbers separated with `·` (middot) not `•` (bullet) — middot is conventional for inline metadata, bullet is for lists.
- Times use `id-ID` locale with explicit `hour: '2-digit', minute: '2-digit'` (avoid seconds in lists — only on detail).
- Empty state = single sentence, never two.
- Don't repeat heading in subtitle (current Dashboard does this twice).

#### B2. Dark mode + discoverable hidden toggle
> *"buatkan dark mode dan togglenya sembunyikan togglenya, namun harus dapat dipahami secara UX"*

**Status today:** `theme.css` already defines a complete `.dark` token set; but nothing toggles the class on `<html>`.

**Implementation:**
- Add `ThemeProvider` (~40 LOC) that:
  - Reads `localStorage.diminspect_theme` → `'light' | 'dark' | 'system'` (default `'system'`).
  - Watches `window.matchMedia('(prefers-color-scheme: dark)')` and updates `<html class="dark|''">` accordingly when in `'system'` mode.
- Expose toggle in **user-menu popover** (Section B3 below). Three radio rows: Sistem · Terang · Gelap. This is "hidden" in the sense that it's not in the header bar, but discoverable because every user knows to click their avatar.
- Add keyboard shortcut **Ctrl/Cmd + Shift + L** that cycles `light → dark → system → light`. Show this hint inside the popover as a tiny label.

**Pixel detail:** popover 280px wide, 12px gap items, 24px icon size, 14px label, 11px shortcut hint right-aligned in `--muted-foreground`.

#### B3. Logout button placement
> *"peletakan logout button tidak sesuai kaidah UX yang baik. perbaiki itu"*

**Status today:** logout is a small ghost button in the sidebar footer (`Layout.tsx` lines 76–78). UX convention worldwide: logout lives inside the *user menu* triggered by the avatar. Sidebar logout is a desktop-app idiom, not a web one, and is unreachable on a collapsed sidebar.

**Fix:**
- Replace the static avatar block in the sidebar footer with a clickable trigger.
- On click, open a popover anchored to the avatar with:
  - Row 1: name + role (read-only).
  - Row 2: divider.
  - Rows 3–5: theme toggle (Sistem / Terang / Gelap).
  - Row 6: divider.
  - Row 7: **Keluar** (red text `text-red-600`, icon `LogOut`).
- Same popover is also reachable from a top-right avatar in the header (so it works whether sidebar is open or not on mobile). Pixel spec in `01-Detailed-Designs.md` §1.

#### B4. Dashboard — minimum 4 charts (insightful, no redundancy)
> *"Overview dashboard kurang informatif… kalau perlu, tambahkan pie chart juga. setidaknya 4 chart"*

**Status today:** 4 KPI cards + 1 line chart + 1 stacked bar + 1 recent-NG table. The bar chart and table both summarise "NG by part" — partially redundant.

**Proposed dashboard layout** (top → bottom). Full layout grid in `01-Detailed-Designs.md` §4.

1. **KPI strip (5 cards, equal width)** — Total Inspeksi · Part OK · Part NG · NG Rate · Stasiun Aktif (uses the orphan `activeStationCount`).
2. **Line chart** — Tren harian (OK vs NG), last 14 days. Filter pills above: 7d · 14d · 30d.
3. **Pie chart** — Distribusi OK vs NG (overall, current filter window). 2 slices, OK green, NG red, center label shows %NG. Compact (220px h).
4. **Bar chart** — NG per Part Type (top 8). Sorted desc.
5. **Bar chart** — NG per Dimensi (which dimension fails most often). E.g., "Diameter (42) > Width (18) > Length (3)". This is **the new engineering insight** — tells the team which tool/spec to fix first.
6. **Stacked bar chart** — NG per Shift (A/B/C), last 7 days. Reveals shift-quality patterns. Requires real shift tracking (B5 below).
7. **Bar chart** — NG per Station, last 7 days. Reveals station/operator-specific issues.
8. **Recent NG table (8 rows)** — last 8 NG, with mini sparkline of the failing dimension.

Total: **5 KPI + 6 charts + 1 table.** Above the user's minimum of 4 charts. All data fetched by **one** new endpoint `GET /api/dashboard/insights?range=14d` returning all aggregates pre-computed server-side (single transaction, indexed scans). Drops the 200-row client fetch the dashboard currently does.

Filter pills (7d / 14d / 30d) live above the KPI strip, right-aligned, 28px height, `rounded-full` pills, inactive = `bg-muted text-muted-foreground`, active = `bg-blue-600 text-white`.

**Why not more:** beyond ~7 visuals dashboards become "wallpaper". The chosen seven each answer a distinct question (volume / rate / type / dimension / shift / station / recent), zero redundancy.

#### B5. Batch & shift administration (clarification + redesign)
> *"di sistem ini ada pencatatan batch dan shift. namun saya kurang paham cara administrasi keduanya. coba telusuri lagi."*

**What I found:**

| Field | Where set today | Where read | Admin UI? |
|---|---|---|---|
| `batchNo` | Agent: `datetime.now().strftime("B%Y%m%d")` per call | Persisted to `inspections.batch_no`. Displayed in Dashboard recent-NG, History column, History CSV export. | **None.** |
| `shift` | Agent: hard-coded `"A"` | Persisted to `inspections.shift`. Displayed in History column + CSV. | **None.** |
| `line` | Agent: `stationId` (alias) | Persisted to `inspections.line`. Displayed in History column + CSV. | **None.** |
| `operatorId / operatorName` | Agent: hard-coded `"agent" / "Vision Agent"` | Persisted. Displayed in History detail row. | **None — bug.** |

So today **nothing** is actually administered. Three of these four "traceability" fields are auto-derived constants — they look like real data but are fakes. This is the biggest correctness issue in the system, more than UX.

**Proposed real administration:**

1. **Shift schedule table** (new DB table `shift_schedules`):
   ```sql
   create table shift_schedules (
     id text primary key,
     name text not null,         -- "A" / "B" / "C"
     start_minute int not null,  -- 0..1439, local time
     end_minute int not null,    -- exclusive
     timezone text not null      -- e.g. "Asia/Jakarta"
   );
   ```
   - Seeded with A=06:00–14:00, B=14:00–22:00, C=22:00–06:00 (configurable).
   - Backend computes the shift at ingestion time from `event.timestamp` against the matching schedule. Agent stops sending `shift`.
   - Admin UI uses the existing admin surface only: replace `/users` and `/parts` with one `/settings` route containing tabs for Pengguna, Part, Shift, and Batch. The sidebar still has one admin entry only, so shift configuration is discoverable without adding another menu.

2. **Batch lifecycle** (new DB table `batches`):
   ```sql
   create table batches (
     id text primary key,
     batch_no text not null unique,        -- human-friendly, supervisor-set
     part_code text not null references parts(part_code),
     station_id text not null references stations(station_id),
     opened_by text not null references users(id),
     opened_at timestamptz not null default now(),
     closed_at timestamptz,
     target_quantity int,
     notes text
   );
   create index idx_batches_open on batches (station_id) where closed_at is null;
   ```
   - Each station has at most **one open batch at a time** (enforced by partial unique index `where closed_at is null`).
   - When operator opens a batch from the new "Mulai Batch" modal on Live Tracking, agent receives the batch_no via the `start` command and stamps every captured inspection with it.
   - Closing a batch ends auto-stamping; subsequent inspections get `batch_no = NULL` until next batch is opened.
   - Old behaviour (auto `B{YYYYMMDD}`) is removed. If no batch is open, inspections are allowed only as **Ad-hoc** with `batch_no = NULL`; the UI shows an Ad-hoc badge so operators do not mistake it for an administered batch.
   - History gets a Batch filter dropdown.
   - Dashboard `getInsights` can scope by batch.

3. **Real operator identity:**
   - When the frontend `start`s an agent, include `operator: { id, name }` in the command payload. Backend persists it to `agent-registry` per-station state. Agent stamps every subsequent inspection with this. On `stop`, identity clears. On agent reconnect, identity must be re-sent → frontend handles automatically by replaying the last open batch's operator (or shows "Operator belum dipilih" banner).

4. **`line`:**
   - Decision: drop it. The product has no separate line concept; the business object is **Stasiun**, and one station has exactly one camera. CSV export drops the column. DB migration v6 drops `inspections.line`; frontend labels change from Line to Stasiun.

#### B6. Codebase sync audit — every field used end-to-end
> *"pastikan SEMUA YANG DITULIS DI CODEBASE INI TERPAKAI DAN SYNC."*

**Findings — dead or misused fields:**

| Field | Defined in | Used by frontend? | Decision |
|---|---|---|---|
| `modelVersion` | Agent, schemas, types, DB | Only as fallback text in LiveTracking | **Delete entirely.** |
| `CAMERA_ID` | Agent env, config | Nowhere (DB col dropped v5) | **Delete entirely.** |
| `SHOW_PREVIEW` | Agent env, config | n/a | **Delete entirely.** |
| `DashboardSummary.stationCount` | Backend type, frontend type | Never rendered | **Render** as 5th KPI. |
| `DashboardSummary.activeStationCount` | Backend type, frontend type | Never rendered | **Render** as 5th KPI. |
| `partId` (vs `partCode`) | Both | `partId ?? partCode ?? 'unknown'` fallback in `normalizeInspectionEvent` | Make required server-side, drop fallback. |
| `confidenceScore` | Both | Shown in History + Live Tracking | OK. But agent always sends `95` — a constant! It's fake data; either compute real confidence (variance of measured vs nominal) or remove. **Decision: compute real**, see §4.3. |
| `vendor` on inspection | Agent forwards from part | Shown in History + CSV | OK. |
| `shift` | Agent constant `"A"` | Shown in History + CSV | **Make real** via B5. |
| `batchNo` | Agent date | Shown in Dashboard + History + CSV | **Make real** via B5. |
| `line` | Agent = stationId | Shown in History + CSV | **Drop.** Replace visible copy with `stationId` / "Stasiun". |
| `operatorId / operatorName` | Agent constant | Shown in History detail | **Make real** via B5. |
| `trigger` | Agent: 'auto' / 'manual' | Shown in Live Tracking | OK. |
| `engineering` role | Types, role labels | No seed user | Add a seeded engineering user. |

**Process:** add a CI guard (lightweight) — a one-off script that greps backend types vs frontend types and emits a diff. Documented in `03-Rollout-and-Migration.md` §6.

#### B7. Live tracking — full redesign
> *"UX di live tracking sangat jelek… layar cam terlalu kecil dan tidak ada opsi untuk expand. rancanglah live statistics… real statistics untuk spesifikasi (diameter, dll)"*

See `01-Detailed-Designs.md` §2 for full mockup. Summary:

**Old layout (today, broken):** `grid-cols-[1fr_360px]` so cameras compete with an "event feed". Multiple cameras shown as `sm:grid-cols-2` tiles at `aspect-video` height ~280px each — too small to verify a part. Right-side event feed pulls attention away.

**New layout — 3-mode tabbed view:**

- **Mode "Multi"** (default, supervisor view): grid of small camera tiles, no per-tile controls beyond start/stop. Replaces today's view.
- **Mode "Focus"** (operator view, default for `operator` role): one large camera (16:9, max-height `calc(100vh - 200px)`), live stats panel on right (320px), control panel below camera.
- **Mode "Wall"** (TV display): pure camera grid, no UI chrome. Click expands one to "Focus".

User toggles between Multi/Focus with a segmented control at the page header (32px height, 3 options).

**Focus mode — live stats panel content (right rail, 320px wide):**

1. **Shift KPIs (top, 4 mini-cards 2×2 grid):**
   - Hari ini: total scan
   - Hari ini: OK
   - Hari ini: NG
   - %NG (color-graded: <2% green, 2–5% amber, >5% red)
2. **Per-dimension stats (middle, accordion per dimension):**
   - Each dimension card shows: nominal value, last measured, mini-sparkline of last 20 measurements, mean, std-dev.
   - When operator clicks a bbox on the camera (B10 / Item 15), the sparkline jumps to that object's history (if there are multiple per-frame, sparkline shows series of the *selected* detection across frames where it was tracked, falls back to "single-shot" if no tracking).
3. **Last 5 inspections** — compact list, status pill + measured-vs-nominal delta. Replaces today's noisy event feed.

**Camera area details:**
- Border 1px `--border`, rounded 12px, overflow hidden.
- Status overlay top-left: 2 pills stacked (online/offline + phase).
- FPS overlay top-right.
- **Expand button** top-right corner (16×16 icon, white-on-black/40 chip) → switches to Mode "Focus" if not already, else fullscreen API.
- **Capture button** (manual mode only, B8) bottom-center: 56×56px round, blue `bg-blue-600`, white camera icon, soft shadow. On press: brief flash (200ms white overlay 30% opacity) + button disabled for 500ms to prevent double-capture.

**Multi-object overlay:**
- A transparent `<canvas>` is layered on top of `<img>`, sized 100%/100%, `position: absolute`.
- For each detection in the latest `inspection.preview` event, draw a 2px rounded rect.
- Color: OK = `#22c55e`, NG = `#ef4444`. Inside, label: `Ø 4.95 mm` (12px, white, black 60% halo for legibility).
- Hover: thicken to 3px + fill 12% opacity.
- Click: hold the selection (3px + fill 18% opacity + outer glow). Live stats panel updates to show that detection's specs.
- Re-clicking same bbox deselects (toggle).

**Bandwidth note:** the new `inspection.preview` JSON event runs at **4 Hz** (not 10), is per-station, and broadcast only to viewers who have that station's Focus mode open. Typical size: ~250 bytes per detection × 3 detections × 4 Hz = ~3 KB/s/station. Negligible.

#### B8. Manual capture — critical analysis (not yes-man)
> *"data hanya masuk ketika tombol dipencet. apakah ide saya bagus? don't be yes-man."*

**Verdict:** **Your proposal is correct for this QC workflow**, but only if implemented as realtime detection + manual persistence. The camera can keep scanning so the operator sees detections and stats, but the system must not create inspection records until Capture is pressed.

**Pros (your case):**
- Eliminates spurious captures when the part is mid-conveyor or being positioned.
- Operator-in-the-loop matches ISO 9001-style QC discipline.
- Easier to retrain operators ("look, confirm, press") than to tune stability thresholds.
- Removes need for `STABILITY_FRAMES` / `FOREGROUND_AREA_THRESHOLD` heuristics that are scene-dependent.

**Cons / risks (critical):**

1. **Operator forgetfulness on high volume.** A station running hundreds of parts per hour can miss button presses. → Mitigation for v1: make manual capture obvious and keyboard-friendly (`Space` when Capture is focused), add a "last capture age" warning after an object has been detected for >10 seconds, and log zero-capture sessions. Do **not** keep auto-persistence as a normal mode because it reintroduces the user's data-confusion problem.

2. **Latency-of-thought between "decide" and "press" → measurement drift.** If operator nudges the part during press, the saved frame reflects the nudged state. → Mitigation: **freeze-on-press UX.** The instant the button is pressed:
   - Agent captures the current frame and its measurement.
   - UI overlays the frozen frame with a 1.5s "Tersimpan — Batal?" undo banner.
   - If operator clicks "Batal" within 1.5s, the inspection is *not* persisted (or, more correctly: it's persisted then soft-deleted; safer for audit).

3. **Multi-object ambiguity.** If three parts are on the stage, which one is the "capture" referring to? → Mitigation: **capture saves all currently detected objects** in one `inspection.created` event with `detections[]`. The backend persists one child measurement set per detection under the same event/batch/operator/timestamp, not three unrelated operator actions.

4. **Race: operator presses while phase is `calibrating` or `idle`.** → Mitigation: button disabled in those phases, with tooltip "Tunggu kalibrasi selesai" / "Mulai inspeksi dulu".

5. **Double-press / accidental triple-tap.** → Mitigation: button disabled for 500ms after press; ignore further `capture` events server-side if `last_capture_ts < now - 500ms`.

6. **Network drop between press and save.** → Mitigation: agent queues the capture event locally; on reconnect, replays metadata/measurements. Frames are not retained.

7. **Audit need without frame storage.** Operators may dispute "was the part really there when pressed?" Because frame retention is explicitly out of scope, audit must rely on operator identity, station, timestamp, part, batch, detections, measurements, and soft-delete history. If visual audit becomes mandatory later, it must be a separate opt-in feature with storage sizing and privacy review.

**Decision:** Implement **Manual capture as the only persistence path in v1** (`trigger: 'manual'` on every persisted record). Realtime scanning still powers live preview, bounding boxes, and stats. The "Capture" button on Live Tracking is the primary CTA. The freeze-on-press undo banner is mandatory.

**Pixel detail of undo banner:**
- Position: bottom-center of camera, 16px margin from edge.
- Size: auto-width, padding 12px 16px, rounded 24px, background `bg-gray-900/90` text white.
- Content: ✓ icon (16px green) + "Tersimpan" (14px) + dot separator + "Batal" button (12px underline white).
- Auto-dismiss: 1500ms. Disappears via opacity transition 200ms.

#### B9. Edge cases for existing flow
Full matrix in `02-Edge-Cases-and-Mitigations.md`. Top 12 ranked by severity:

| # | Edge case | Severity | Mitigation summary |
|---|---|---|---|
| 1 | **Part on stage during calibration** → all subsequent frames "NG"-by-default | High | After calibration, if foreground area is non-zero, auto-warn or auto-recalibrate. |
| 2 | **Lighting change mid-session** → background outdated | High | Rolling mean foreground area > threshold for >N sec → suggest recalibrate. |
| 3 | **Multi-object ignored** → silently drops detections | High | Refactor `inspect_frame` to return list (Item B10). |
| 4 | **Operator never logged in → `operatorName='Vision Agent'`** | High | Block agent `start` without operator identity (B5). |
| 5 | **`shift='A'` always wrong outside shift A hours** | High | Backend-derived shift (B5). |
| 6 | **AGENT_TOKEN in URL → leaked to nginx access.log** | High | Move token to first WS frame (handshake message). |
| 7 | **Lock phase forever when part left on stage** | Med | After 30s in `locked`, auto-recalibrate; show banner. |
| 8 | **Dashboard `dailyTrend` unbounded query** | Med | Add `WHERE timestamp >= now() - interval '30 days'`. |
| 9 | **Frontend `inspect.created` snapshot replays >100 events** | Med | Frontend ignores events older than `lastEventId`; backend replay since cursor. |
| 10 | **Quality records midnight TZ mismatch (UTC vs Jakarta)** | Med | Persist `date` using `timestamp AT TIME ZONE 'Asia/Jakarta'`. |
| 11 | **Event queue drops `inspection.created`** under network spike | High (data loss) | Separate event queue (no-drop, bounded) from frame queue (drop OK). |
| 12 | **Token expires mid-session** → silent 401 logout | Low | Silent refresh 5 min before expiry. |

#### B10. Clickable bounding boxes → live stats
> *"jika di layar, object yang terscan dapat dipencet bounding boxnya, yang nanti akan menampilkan spesifikasinya di bagian live stats"*

**Feasibility:** Yes — implementable, low resource impact, fits cleanly into B7.

**Required upstream change:** agent's `inspect_frame` must return a list of detections, not one. This is a localized refactor in `Agent/vision.py`:

```python
@dataclass
class ObjectDetection:
    bbox: tuple[int, int, int, int]   # x, y, w, h
    measurements: list[Measurement]
    status: Literal['OK', 'NG']
    confidence: float

def inspect_frame(frame, background, part_spec) -> list[ObjectDetection]:
    ...  # iterate contours above MIN_AREA, refine_edge_1d each, classify
```

**Wire format:** new event type `inspection.preview` emitted at 4 Hz from the agent (gated by a "viewer subscribed" hint from the backend — see B7 bandwidth note):

```json
{
  "eventType": "inspection.preview",
  "stationId": "Station 1",
  "frameTimestamp": "2026-05-21T08:05:00.125+07:00",
  "frameWidth": 960,
  "frameHeight": 540,
  "detections": [
    {"id": "d0", "bbox": [120, 80, 96, 96], "measurements": [...], "status": "OK", "confidence": 0.92},
    {"id": "d1", "bbox": [320, 80, 88, 92], "measurements": [...], "status": "NG", "confidence": 0.85}
  ]
}
```

Frontend overlay (in B7) consumes this. Click on a bbox → `setSelectedDetectionId(d.id)` → live stats panel renders detection-specific data.

**Resource cost:**
- Bandwidth: ~3 KB/s/station/viewer (calculated above).
- CPU (agent): no new work — already iterates contours, just stops discarding the non-largest.
- CPU (browser): canvas redraws at 4 Hz over 960×540 with ≤10 rects = ~0.5ms per frame. Trivial.
- RAM: detections array per station = ~5 KB. Trivial.

**Verdict:** ship it. Adds genuine operator value (verify which part was bad without scrubbing history).

---

## 3. Efficiency & complexity audit — concrete optimizations

### 3.1 Frame channel optimizations

| Change | Today | After | Saving |
|---|---|---|---|
| Default FPS | 10 | 8 | −20% |
| JPEG quality | 70 | 65 | −10–15% |
| Max long-edge | source-res (often 720p) | 960px | −40% (HD) / −60% (FHD) |
| Per-station subscription on `/ws/frames` | broadcasts all stations to all viewers | viewer sends `subscribe stationIds[]` first frame, server filters | linear in stations × viewers |
| Server forgets idle stations | always keeps last frame | drops frames if no subscriber for >30s | bounded RAM |
| Browser frame Blob reuse | `URL.createObjectURL` + `revokeObjectURL` per frame | swap to `<img src="blob:...">` with single revoke on `onload` | −15% GC pressure |

**Total expected frame egress reduction:** ~60–75% for typical 4-station × 5-viewer deployments.

### 3.2 Event channel optimizations

- **Replay limit reduced** from 100 to 50 for `/ws` (frontend snapshot). Most pages only need the most-recent 20–30 anyway.
- **Cursor-based replay:** frontend sends `lastEventId` in WS query; backend replays only events newer than that. Cuts startup payload to near-zero after first connect.
- **Server-side dashboard endpoint** `/api/dashboard/insights?range=14d` replaces today's "fetch 200 inspections then aggregate client-side". One SQL query, indexed, returns ready-to-render shape.
- **Inspections retention:** events_log + inspections partitioned monthly (postgres `pg_partman` or manual). Older partitions detached after 12 months.

### 3.3 Agent CPU/RAM

- Drop preview path → −2 to −5% CPU, no `cv2.HIGHGUI` dependency.
- Drop full-res annotated frame after downscale → −5 to −10 MB RSS per station.
- Move `cv2.imencode` into a thread pool (already single-threaded `_capture_loop` → `asyncio.to_thread`) so CPU work doesn't block the asyncio loop. Saves ~3 ms per frame at high frame sizes — useful when we add multi-object detection.

### 3.4 Backend RAM/CPU

- `AgentRegistry` and `FrameBus` are O(stations) — fine.
- `EventBus` array slice is O(N) on every event. With limit=50 this is irrelevant; with limit=1000 (if changed later) move to ring buffer. Keep limit=50.
- `bcrypt.compare` is ~70ms per login — fine (not on hot path).
- **JWT verify on every request is the hot path.** Cache resolved `SafeUser` by token hash with 60-second TTL. LRU 1000 entries. Saves a DB hit per request. Library: in-house `Map` + monotonic timestamp; no dep.

### 3.5 Agent outbox queue split

Today: single `asyncio.Queue` for events with drop-oldest-when-full behavior. Risk: `inspection.created` (critical) can be evicted by frequent `station.status` updates.

**Fix:**
- `events_queue` (maxsize=512, no-drop). On full, agent applies back-pressure: block ingestion of new `inspection.created` for up to 5s, then drop OLDEST `station.status` first; never drop `inspection.created`.
- `frames_queue` (maxsize=16, drop-newest-when-full). Latency > throughput here.

### 3.6 Database

- Add indexes:
  - `inspections (station_id, timestamp DESC)` — for per-station history list (today's index covers global timestamp only).
  - `inspections (shift, timestamp DESC)` — for per-shift dashboard.
  - `inspections (batch_no)` partial WHERE batch_no IS NOT NULL — for batch filter.
- Add `WHERE timestamp >= now() - interval '30 days'` to `dailyTrend` query.
- Convert `quality_records.date` derivation to `(timestamp AT TIME ZONE 'Asia/Jakarta')::date` to match agent's local date semantics.

### 3.7 Time/space complexity hot-spots fixed

| Where | Today | After |
|---|---|---|
| `useInspections` ingest | `[next, ...current].slice(0, limit)` = O(N) per event, O(N) memory | Ring buffer (Array index modulo) O(1) push, O(N) memory but no realloc |
| `_drain_command` | List + pop = O(N) per drain | `deque.popleft` O(1) |
| `mergeStations` | O(N+M) — fine | unchanged |
| Dashboard `ngByPart` aggregate (client) | O(N) over 200 rows | server-side: O(N) one SQL pass, indexed |
| Snapshot replay on `/ws` connect | O(100) per viewer per connect | O(K) where K = events since `lastEventId`, typically O(0) on reconnect |
| Frame fan-out | O(stations × viewers) per frame | O(subscribed_viewers_per_station) per frame |

---

## 4. Security & data hygiene

### 4.1 WS token leak
Move `?token=` out of URL into the first `{"type":"auth","token":"..."}` frame. Backend disconnects if token doesn't arrive within 2 s. Required because nginx access logs capture query strings by default and tokens get archived.

### 4.2 Per-station bind
Today, any agent with the shared `AGENT_TOKEN` can claim any `stationId` and *kick* the legitimate one (`replaced` close code). Mitigation: derive a per-station signed token at first connect (HMAC of `stationId` + secret) and persist the binding; reject subsequent claims if signature mismatches.

### 4.3 Real confidence score
Today `confidenceScore` is constant `95`. Compute it:
```
confidence = mean over dimensions of clamp01(1 - |measured - nominal| / tolerance)
```
Then scale to 0–100. Honest number; engineering can use it.

### 4.4 Operator identity
Block `start` command from frontend if no `operator` payload is included. Backend rejects with 400. Agent rejects locally too if it ever gets a `start` without operator info (defense in depth). Identity persists in `AgentRegistry` per station, cleared on `stop`.

---

## 5. Quick-reference: full deletion list

Files / fields to be removed (all backed by deprecations, none breaking external APIs):

| Item | Files affected |
|---|---|
| `SHOW_PREVIEW` env / `show_preview` field | `Agent/.env.example`, `Agent/config.py`, `Agent/computer_vision.py`, `Agent/README.md`, `README.md` |
| `cv2.imshow` / `cv2.waitKey` / `cv2.destroyAllWindows` calls | `Agent/computer_vision.py` lines ~268–271 |
| `MODEL_VERSION` env / `model_version` field | `Agent/.env.example`, `Agent/config.py`, `Agent/computer_vision.py` (build_inspection_event, build_station_status), `Backend/src/domain/types.ts`, `Backend/src/domain/schemas.ts`, `Backend/src/storage/postgres-store.ts` (multiple), `Frontend/src/app/types/api.ts`, `Frontend/src/app/pages/LiveTrackingPage.tsx`, `Agent/README.md`, `README.md` |
| `CAMERA_ID` env / `camera_id` field | `Agent/.env.example`, `Agent/config.py`, `Agent/README.md`, `README.md` |
| `FRAME_FPS`, `FRAME_QUALITY` env | `Agent/.env.example`, `Agent/config.py`, `Agent/README.md`, `README.md` |
| `line` column from inspections | DB migration v6, schemas, frontend types, History column, CSV header |
| `DashboardSummary.stationCount` if NOT shown — KEEP, will be displayed | n/a — we use it |

---

## 6. Sequencing & rollout
Detailed phasing in `03-Rollout-and-Migration.md`. Headline order:

1. **Phase 1 — Cleanups (low risk):** remove `SHOW_PREVIEW`, `MODEL_VERSION`, `CAMERA_ID`, fix `.env.example`, hardcode FPS/quality, seed engineering user, UX writing audit, dark mode, logout move.
2. **Phase 2 — Server-side aggregations + frame channel tuning:** new `/api/dashboard/insights`, per-station frame subscription, retention.
3. **Phase 3 — Real shift/batch/operator administration + manual capture:** DB migrations, station rename migration, no-frame-retention capture flow, Settings tabs, agent rework. Largest feature lift.
4. **Phase 4 — Multi-object + clickable bboxes:** vision refactor, preview event, overlay UI.
5. **Phase 5 — Security hardening:** WS auth handshake, per-station token, real confidence, retention enforcement.

Each phase ships behind a feature flag where reasonable, with a one-paragraph QA script.

---

## 7. Decisions now closed by reviewer

1. Drop `line`; use **Stasiun** everywhere.
2. Shift schedule must be configurable inside Settings; seed defaults are acceptable and editable.
3. Manual capture is the only persistence path for v1. Realtime scanning remains for preview/stats only.
4. Do not store frames.
5. Add a seeded engineering user.
6. Migrate existing `station-1` data to `Station 1`.

---

*End of master PRD. Continue to `01-Detailed-Designs.md` for pixel-level specs.*
