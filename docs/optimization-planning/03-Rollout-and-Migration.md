# 03 — Rollout, Migration, and Sequencing

> Companion to `00-PRD-DimInspect-Optimization.md` §6.

The PRD is large. Shipping it in one PR would be reckless. This document phases the work into ~5 PRs sized so each is independently reviewable, deployable, and reversible.

---

## Phase summary

| Phase | Goal | Risk | Reversible? | Suggested PR size |
|---|---|---|---|---|
| **P1** | Dead-code removal + UX polish + dark mode + logout move | Low | Yes (revert PR) | ~600 LOC |
| **P2** | Server-side aggregations + frame channel tuning + event retention | Med | Yes (revert + run rollback SQL) | ~800 LOC |
| **P3** | Real shift/batch/operator administration + manual capture (default) | High | Partial (DB migrations forward-only; data preserved) | ~1500 LOC + DB v6 |
| **P4** | Multi-object detection + clickable bboxes + preview event | Med | Yes (feature flag) | ~700 LOC |
| **P5** | Security hardening (WS auth handshake, per-station token, real confidence, retention enforcement) | Med | Yes (feature flag) | ~400 LOC |

Each phase produces a single PR, merged when CI is green, tagged, and shipped.

---

## P1 — Dead-code removal + UX polish (LOW risk)

### Scope

- Delete `SHOW_PREVIEW` / `cv2.imshow` path.
- Delete `MODEL_VERSION` from agent, backend types/schemas, frontend types, DB columns (migration v6.1).
- Delete `CAMERA_ID` from agent + env example + READMEs.
- Hardcode `FRAME_FPS=8`, `FRAME_QUALITY=65`, add downscale to 960px.
- Change `STATION_ID` example value to `Station 1`.
- Add seeded `engineering` user.
- UX writing audit (string table in `01-Detailed-Designs.md` §3.2).
- Dark mode + ThemeProvider + popover toggle.
- Logout button moved to user popover (sidebar + header avatar).

### DB migration (v6.1)

```sql
ALTER TABLE inspections DROP COLUMN IF EXISTS model_version;
ALTER TABLE stations    DROP COLUMN IF EXISTS model_version;
```

Forward-only. Old rows lose the (already-cosmetic) column. No data backfill needed.

### Verification

- Manual: open dashboard in both themes, ensure all charts render. Switch Ctrl+Shift+L.
- Manual: ensure agent runs without `SHOW_PREVIEW`, `MODEL_VERSION`, `CAMERA_ID`, `FRAME_FPS`, `FRAME_QUALITY` set.
- Manual: verify frame size dropped (Network panel — JPEG size ~25-30KB at 960×540 q65).
- Lint + typecheck + build.

### Rollback

Revert PR; re-add DB columns if needed (`ALTER TABLE ... ADD COLUMN model_version text`). Data not recoverable but it was cosmetic.

---

## P2 — Server-side aggregations + frame channel tuning (MED risk)

### Scope

- New endpoint `GET /api/dashboard/insights?range=7d|14d|30d`.
- Dashboard page replaced with new 5-KPI + 6-chart + 1-table layout (per `01-Detailed-Designs.md` §4).
- Frame WS subscription: client sends `{type:'subscribe',stationIds:[]}`; server filters.
- Frame BlobURL — revoke on `<img>.onload` rather than next frame.
- `getEvents` snapshot replay: `?since=lastEventId` cursor.
- Event retention job: nightly delete from `event_log` >30 days. Do not store or retain camera frames.
- Add indexes: `inspections (station_id, timestamp DESC)`, `inspections (shift, timestamp DESC)`.
- Dailytrend `WHERE timestamp >= now() - interval '30 days'`.
- Token-cache LRU 60s.
- Reduce `EVENT_REPLAY_LIMIT` default from 100 to 50.

### DB migration (v6.2)

```sql
CREATE INDEX IF NOT EXISTS idx_inspections_station_ts ON inspections (station_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_shift_ts   ON inspections (shift, timestamp DESC);
```

### Verification

- Load dashboard, ensure all 6 charts populate, KPI strip shows `activeStationCount`.
- Network: only `/api/dashboard/insights` is fetched, no large `/api/inspections?limit=200`.
- Live tracking: open with 2 tabs subscribed to different stations; verify each tab only receives its own frames (DevTools Network → WS → frames count).

### Rollback

Revert PR; drop indexes; original endpoints remain (we add, not replace, in this phase).

---

## P3 — Real shift/batch/operator administration + manual capture (HIGH risk)

### Scope

- **DB migration v6.3:**
  ```sql
  CREATE TABLE shift_schedules (
    id text PRIMARY KEY,
    name text NOT NULL UNIQUE,
    start_minute int NOT NULL,
    end_minute int NOT NULL,
    timezone text NOT NULL DEFAULT 'Asia/Jakarta'
  );
  INSERT INTO shift_schedules VALUES
    ('shift-A', 'A', 360, 840, 'Asia/Jakarta'),    -- 06:00–14:00
    ('shift-B', 'B', 840, 1320, 'Asia/Jakarta'),   -- 14:00–22:00
    ('shift-C', 'C', 1320, 1800, 'Asia/Jakarta')   -- 22:00–06:00 (wraps; backend handles)
    ON CONFLICT DO NOTHING;

  CREATE TABLE batches (
    id text PRIMARY KEY,
    batch_no text NOT NULL UNIQUE,
    part_code text NOT NULL REFERENCES parts(part_code),
    station_id text NOT NULL,
    opened_by text NOT NULL REFERENCES users(id),
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    target_quantity int,
    notes text
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_one_open_per_station
    ON batches (station_id) WHERE closed_at IS NULL;
  ```

- **Backend:**
  - `start` command requires `operator: {id,name}`, optional `batchId`.
  - `AgentRegistry` stores active operator + batch per station.
  - Ingestion derives `shift` from `event.timestamp` + `shift_schedules`.
  - Ingestion stamps `operator_id`, `operator_name`, `batch_no` from registry, not from event payload.
  - New routes: `/api/shifts` (GET/POST/PATCH/DELETE), `/api/batches` (GET/POST), `/api/batches/:id/close`, `/api/agents/:stationId/open-batch`.

- **Agent:**
  - Removes hardcoded `operatorId/operatorName/shift/batchNo` from payload.
  - Default persistence mode: `manual`. Realtime scanning continues for preview/statistics, but records are created only on `capture`.
  - Implements `freeze-on-press`: on `capture` command, freezes the current detection result, emits `inspection.created`, replies with the inspection ID for undo support. No frame retention.

- **Frontend:**
  - `/users` + `/parts` → `/settings` route with tabs: Pengguna, Part, Shift, Batch. This keeps shift configuration UX-friendly without adding a new sidebar menu.
  - Live Tracking Focus mode adds batch picker + open-batch modal.
  - Capture button always visible; freeze-on-press undo banner (1.5s).
  - History filter adds Batch dropdown.

### Verification

- E2E: admin creates shift schedule A/B/C. Open batch on station 1 with part RDB-001. Inspect 5 parts in manual mode. Verify all have correct operator, batch_no, and shift derived from time of day.
- Test wrap-around shift C (22:00–06:00).
- Test no-batch state (Ad-hoc badge in History).
- Test rejecting `start` without operator.

### Rollback (partial)

DB migration is forward-only. Rolling back the code while keeping the schema is fine; new fields stay nullable. To fully roll back: code revert + `DROP TABLE batches, shift_schedules` (data loss for those tables only).

### Risks

- Existing inspections will have `shift='A'` from the agent (or the new `shift` set at ingestion). For data consistency, run a one-off backfill:
  ```sql
  UPDATE inspections
  SET shift = derive_shift(timestamp)
  WHERE shift IS NOT NULL;
  ```
  (Implement `derive_shift` in SQL using `shift_schedules`.)

---

## P4 — Multi-object + clickable bboxes (MED risk)

### Scope

- Agent `vision.py` refactor: `inspect_frame` returns `list[ObjectDetection]`.
- New event type `inspection.preview` (4 Hz, only when ≥1 viewer subscribed).
- Backend types + schema for `inspection.preview` (not persisted; relayed via `/ws`).
- Frontend overlay canvas in Live Tracking Focus mode.
- Click-to-select bbox; per-detection stats in right rail.
- `inspection.created` now supports `detections: ObjectDetection[]`. One operator Capture creates one inspection event; each detected object is stored as a child detection/measurement set sharing the same `batch_no`, `shift`, `station_id`, and `operator`.

### Verification

- Place 1, 2, 3 parts. Verify all are detected & bboxed.
- Click each bbox; verify right rail updates.
- Persist 3-object capture; verify 3 inspection rows in DB.

### Rollback

Feature flag `MULTI_OBJECT_ENABLED` (default off in agent). If disabled, agent reverts to single-largest behavior.

---

## P5 — Security hardening (MED risk)

### Scope

- WS handshake auth: agent sends `{"type":"auth"}` as first message; server disconnects after 2s if not received.
- Per-station token (HMAC of stationId + AGENT_SECRET).
- Real confidence score (computed from |measured - nominal| / tolerance).
- `JWT_SECRET` and `AGENT_TOKEN` refuse to start in production if equal to defaults.
- Rate limit `/api/auth/login` to 5/minute.
- `CORS_ORIGIN` required in production.
- Retention enforcement job (cron via setInterval in main process; or external cron).
- Token refresh endpoint + silent refresh.

### Verification

- Try ws connect without auth message → disconnected at 2s.
- Try connecting with wrong stationId for a token → rejected.
- Login >5 times → 429.
- Start backend with default `JWT_SECRET=change-me-in-production-please-use-long-secret` and `NODE_ENV=production` → refuses to start.

### Rollback

Feature flag for each item; can disable individually.

---

## 5. CI / quality gates per PR

Each PR must pass:
- `cd Backend && npm run build`
- `cd Frontend && npm run build`
- Type-check passes in both.
- Manual: run `docker compose up` and click through every page.
- A short demo recording attached to the PR description (per session guidelines).

---

## 6. Cross-cutting tools to add

1. **Dead-code detector script** (one-off):
   ```bash
   # find fields in Backend types that aren't referenced in Frontend
   node tools/cross-check-types.mjs
   ```
   - Reads `Backend/src/domain/types.ts`, parses interfaces.
   - Greps `Frontend/src` for each field name.
   - Reports fields never read.
   Run before every PR merge.

2. **Bundle size budget:** `Frontend/dist` must stay <300KB gz for entry chunk.

3. **Runtime perf budget** (manual, not enforced): live tracking page <50ms render p95.

---

## 7. Reviewer decisions already applied

| Topic | Final decision |
|---|---|
| Station naming | `.env.example` uses `STATION_ID=Station 1`; existing `station-1` data must migrate to `Station 1`. |
| Line vs station | Drop `line`; use "Stasiun" everywhere. One station has exactly one camera. |
| Shift administration | Shift schedules are configurable in Settings, not a new menu. |
| Capture flow | Realtime scanning remains for preview/stats; persistence happens only when Capture is pressed. |
| Frame retention | Do not store camera frames. Stream only. |
| Engineering role | Add a seeded engineering user. |
| Multi-object capture | One operator Capture creates one inspection event containing all detected objects in `detections[]`. |

No further product decisions are required before starting P1/P2. P3/P4 still need technical design review because they touch schema and agent protocol.

---

*End of rollout plan. The three documents — `00`, `01`, `02`, `03` — together form the complete PRD.*
