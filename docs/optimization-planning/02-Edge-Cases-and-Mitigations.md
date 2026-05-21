# 02 — Edge Cases & Mitigations

> Companion to `00-PRD-DimInspect-Optimization.md` §B9.

Severity rubric:
- **S0** = data loss or silent corruption.
- **S1** = visible incorrect data, but recoverable.
- **S2** = UX papercut.
- **S3** = cosmetic / dev quality.

---

## 1. Vision pipeline

### 1.1 Part on stage during calibration  — S0
**Repro:** Operator clicks "Mulai" without clearing the stage.
**Today:** background = average of 30 frames *including* the part. All subsequent diffs treat the part as "background". Most inspections then get 0-area foreground and are silently skipped, or detect false edges and return wildly wrong measurements.
**Mitigation:**
- After `calibrate_background` completes, take one *additional* frame, compute foreground area against the new background.
- If `foreground_area > FOREGROUND_AREA_THRESHOLD * 0.3`, treat as failed calibration. Emit `station.status` with `phase='calibration_failed'` and an `errorMessage`.
- Frontend shows red banner "Kalibrasi gagal — kosongkan stage lalu coba lagi" with a `Coba lagi` button.

### 1.2 Lighting change mid-session — S1
**Repro:** Someone flips a fluorescent on/off, sun moves, hand passes over stage.
**Today:** background frozen. Foreground area shifts up across the whole frame → false positives.
**Mitigation:**
- Maintain a rolling 30-second mean of foreground area while stage is "empty" (phase `ready`).
- If mean drifts above `2 × FOREGROUND_AREA_THRESHOLD` for >5 s, emit `phase='needs_recalibration'` and surface banner "Cahaya berubah — kalibrasi ulang?".
- Optional v1.1: adaptive background = EMA with `α = 0.05` when in `ready` phase only (never when something is detected).

### 1.3 Multi-object scene silently truncated — S0 → S1
**Repro:** Two parts placed simultaneously.
**Today:** `inspect_frame` returns one detection (largest contour). The other part is missing from inspection records.
**Mitigation:** refactor to return `list[ObjectDetection]` (see PRD §B10). On manual capture, all current detections persist as separate measurements within one inspection event.

### 1.4 Lock phase forever — S2
**Repro:** Operator captures, walks away. Part stays on stage. `CLEAR_FRAMES` never reached → permanently locked.
**Mitigation:** auto-recalibrate after 60 s in `locked`. Show banner "Inspeksi selesai — angkat part".

### 1.5 Reflective / metallic parts — S2
**Repro:** RDB-001 has shiny surface. Background subtraction picks up reflections.
**Mitigation:** add `cv2.threshold` step with adaptive threshold; document a per-part advanced setting (out of scope v1, log as known issue).

### 1.6 Camera index drift on USB reconnect — S2
**Repro:** Webcam unplugged, replugged. Index reassigned by OS.
**Today:** agent reads `CAMERA_INDEX` once; on reconnect, may grab the wrong device.
**Mitigation:** prefer device-path / UVC-name when available (Linux v4l2-ctl, Windows WMI). Out of scope v1; log as known issue.

### 1.7 First-frame race — S2
**Repro:** Agent grabs first frame before camera auto-exposure settles.
**Today:** calibration uses 30 frames at 0.05s interval = 1.5s — may not be enough.
**Mitigation:** discard first 10 frames before calibration starts. Total calibration time 2s — acceptable.

### 1.8 Stable false positive during conveyor motion — S1
**Repro:** Conveyor stops with a part halfway through frame.
**Today:** `STABILITY_FRAMES=5` fires capture for "moving" part.
**Mitigation:** with manual persistence, this no longer creates a record. Keep realtime detection visible, disable Capture while motion is above threshold, and show "Tunggu part stabil" if the operator tries to capture too early.

---

## 2. Identity & administration

### 2.1 Operator field always "Vision Agent" — S0 (traceability)
**Repro:** Any inspection.
**Today:** agent hardcodes `operatorId='agent'`, `operatorName='Vision Agent'`.
**Mitigation:** require `operator: { id, name }` in every `start` command from frontend; store in `AgentRegistry`; agent stamps each inspection. Reject `start` without operator at backend (HTTP 400).

### 2.2 Shift always "A" — S0
**Same as 2.1 — see PRD §B5. Backend computes from timestamp + shift_schedules table.

### 2.3 BatchNo always per-day per-station — S1
**Same as 2.1 — see PRD §B5. Real batch lifecycle.**

### 2.4 Two operators "Start" same station simultaneously — S2
**Today:** Last write wins. The first operator is silently displaced.
**Mitigation:** server returns 409 if station already running; frontend shows "Sudah dimulai oleh: {name}. Override?".

### 2.5 Operator logs out while station running — S1
**Today:** Inspections keep being attributed to that operator's last identity.
**Mitigation:** on logout, frontend POSTs `/api/agents/{station}/command {stop}` for any station currently bound to this operator. Confirm with user "Berhentikan stasiun aktif?" before logout.

### 2.6 Token expiry mid-session — S2
**Today:** 7-day JWT default; never refreshed; first expired request silently logs out.
**Mitigation:** silent refresh — call `/api/auth/refresh` 5 minutes before `exp` (decode JWT locally for `exp`). Add `POST /api/auth/refresh` endpoint that re-signs with same payload + new `exp`.

---

## 3. Realtime & networking

### 3.1 AGENT_TOKEN in URL leaked to nginx access.log — S0 (security)
**Today:** `ws://.../ws/agent?stationId=X&token=Y`. nginx logs the entire URI.
**Mitigation:** move token to first WS message: `{"type":"auth","token":"...","stationId":"..."}` with 2s handshake timeout.

### 3.2 Shared AGENT_TOKEN allows station impersonation — S0
**Today:** any holder of the shared secret can claim any stationId.
**Mitigation:** per-station HMAC token. Initial registration: admin generates token from `HMAC(secret, stationId)` and copies to that station's `.env`. Backend verifies signature on connect.

### 3.3 Event queue drops `inspection.created` — S0
**Today:** Single agent `events_queue` with drop-oldest-when-full. A burst of `station.status` updates can evict a freshly enqueued `inspection.created`.
**Mitigation:** split queues — events (no-drop, bounded 512, back-pressure) vs frames (drop-newest, bounded 16). On events queue full, agent must surface "Backlog penuh" banner to operator and refuse to capture more until drained.

### 3.4 WebSocket reconnect storm — S2
**Today:** exponential backoff exists in both agent and frontend (cap 15s). Good.
**Risk:** thundering-herd if backend restarts → all viewers reconnect together.
**Mitigation:** add 0–2 s jitter to backoff.

### 3.5 Frame BlobURL leak — S2
**Today:** `URL.createObjectURL` per frame, revoked when the *next* frame arrives. If user navigates away mid-frame, the most recent BlobURL leaks until tab closes.
**Mitigation:** in `useFrameStream` cleanup, revoke all URLs (already done — verified by reading). But also: switch to `<img>`'s `onload` handler to revoke immediately after the image has been decoded; do not wait for the next frame. Cuts peak RAM by 50%.

### 3.6 Event replay older than `lastEventId` floods reconnects — S2
**Today:** Server replays last 100 events on every reconnect. Frontend dedupes by id.
**Mitigation:** Frontend sends `?since=lastEventId` in WS query; server replays only newer events. Reduces snapshot to ~0 on rapid reconnects.

### 3.7 Frame fan-out scales as O(stations × viewers) — S1 perf
**Mitigation:** subscription model on `/ws/frames`. First message from client: `{"type":"subscribe","stationIds":["..."]}`. Server filters.

### 3.8 No keep-alive on idle WS — S2
**Risk:** Some proxies (nginx default 60s, Cloudflare 100s) close idle WS. Causes spurious reconnects.
**Mitigation:** server emits a `{"type":"ping"}` every 25 s on each socket; client responds with `{"type":"pong"}`. (fastify-websocket auto-handles native ping/pong but explicit JSON ping survives more layers.)

---

## 4. Persistence & timezones

### 4.1 `quality_records.date` uses UTC slice vs agent's Jakarta time — S1
**Today:** Backend slices `event.timestamp.slice(0,10)`. Agent sends ISO with `+07:00` offset, so the leading 10 chars are Jakarta date — which is good. **But** the dailyTrend query uses `to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')` (or default depending on DB tz) — mismatch with quality_records.
**Mitigation:** standardize: everywhere a "date" is derived, use `(timestamp AT TIME ZONE 'Asia/Jakarta')::date`. Add a Postgres function `local_date(timestamptz) RETURNS date` for clarity.

### 4.2 `event_log` grows unbounded — S2
**Mitigation:** retention job: nightly `DELETE FROM event_log WHERE created_at < now() - interval '30 days'`. Sized to be cheap (index on created_at).

### 4.3 `inspections` grows unbounded — S2 (eventually S1 storage)
**Mitigation:** partition by month (`pg_partman` or native declarative partitioning). Detach partitions older than 12 months to cold storage. For VPS deployments, just keep 6 months online.

### 4.4 Migration v6 drops columns referenced by old rows — N/A
PostgreSQL `DROP COLUMN` is online and safe; no data backfill needed.

### 4.5 `quality_records` recomputed live — S2
**Today:** Each ingest upserts the row; OK.
**Risk:** if backend restarts mid-batch, the upsert state is recomputed correctly on the next ingest. OK.

---

## 5. Dashboard & queries

### 5.1 `dailyTrend` query unbounded — S2
**Mitigation:** `WHERE timestamp >= now() - interval '30 days'`.

### 5.2 200/1000-row inspections fetch on every dashboard load — S2
**Mitigation:** new `/api/dashboard/insights` endpoint (PRD §B4). Frontend uses just that.

### 5.3 Recharts re-renders on every event due to state churn — S2
**Mitigation:** `useDeferredValue` around the chart data, or throttle the dashboard refresh to once per 500ms (debounce already exists in `useDashboardSummary`).

### 5.4 History table renders all 1000 rows when no filter — S2
**Mitigation:** virtualize with `react-window` (adds ~7KB), OR keep pagination at 15/page (already done) and lower fetch limit to 200.

### 5.5 CSV export doesn't escape commas / quotes — S1
**Today:** plain string concat. Part names with commas would break columns.
**Mitigation:** wrap each cell in `"..."` and double internal quotes (`replace(/"/g, '""')`).

---

## 6. UI

### 6.1 Sidebar logout unreachable on collapsed mobile drawer — S2
**Mitigation:** PRD §B3 — move to popover accessible from both sidebar and header avatar.

### 6.2 Toast stacks invisibly when fired in rapid succession — S2
**Today:** Single toast state, last-write-wins.
**Mitigation:** queue toasts; render up to 3 stacked; auto-dismiss FIFO.

### 6.3 No focus management when modal/popover opens — S2
**Mitigation:** trap focus inside popovers; restore on close.

### 6.4 Hover-only affordances on mobile — S2
**Today:** "expand row" and "expand part" require hover discovery.
**Mitigation:** add explicit chevron/affordance always visible.

### 6.5 Color-only status indication — S2 (a11y)
**Today:** OK/NG by color alone in some places.
**Mitigation:** always pair color with text ("OK"/"NG") or icon. Already done in History.

### 6.6 Long station IDs overflow tile header — S2
**Today:** Already uses `truncate min-w-0`. OK.

### 6.7 No skeleton for charts during refetch (only initial load) — S3
**Mitigation:** show a translucent overlay with spinner during refresh; no jarring re-mount.

---

## 7. Manual capture mode (new in this PRD)

### 7.1 Double-press → duplicate record — S1
**Mitigation:** 500 ms cooldown disabled state on Capture button + server rejects `capture` if last capture for this station was <500 ms ago.

### 7.2 Press during phase=calibrating — S2
**Mitigation:** Capture button disabled with tooltip "Tunggu kalibrasi selesai".

### 7.3 Network drop between press and persist — S0
**Mitigation:** agent persists capture intent and computed measurement payload locally (sqlite at `/app/data/agent_outbox.db` or simple JSON file). On reconnect, replays metadata/measurements only. Camera frames are not retained.

### 7.4 Operator presses, then nudges part within 1.5s undo window — S1
**Mitigation:** if no "Batal" click within the 1.5 s window, persist as-is. Operator awareness training; UX visually freezes the latest streamed frame/detection during the window, but the backend stores only measurements/detections.

### 7.5 Operator captures with zero detections — S2
**Today:** Would persist an inspection with empty measurements.
**Mitigation:** disable Capture button when `detections.length === 0`; tooltip "Belum ada part terdeteksi".

### 7.6 Soft-delete via Batal needs auth — S0 (audit)
**Mitigation:** require auth (existing token); record `deleted_by` and `deleted_at`. Add row to audit log.

### 7.7 Quality records mutated by soft-delete — S1
**Today:** Each ingest upserts daily totals. A soft-delete needs to decrement them.
**Mitigation:** rebuild quality_records row for the affected (date, partCode) on soft-delete. SQL: re-aggregate over non-deleted inspections for that day+part.

---

## 8. Performance & resource

### 8.1 `cv2.imencode` blocks asyncio loop — S2
**Mitigation:** `await asyncio.to_thread(cv2.imencode, ...)`. Trivial change, real win once we add multi-object detection.

### 8.2 Bcrypt-on-every-login (10 rounds, ~70ms) — S3
**Acceptable.** Login is rare.

### 8.3 JWT verify per request — S2
**Mitigation:** in-process LRU cache by token hash, 60s TTL, max 1000 entries.

### 8.4 Recharts SVG re-renders heavy on 30-day series — S2
**Mitigation:** memoize chart series; only update when array reference changes.

### 8.5 Tailwind `@source` rescans on every dev change — S3
**Acceptable.** Dev-only.

---

## 9. Security

### 9.1 Default JWT secret in repo — S1
**Today:** `JWT_SECRET=change-me-in-production-please-use-long-secret` default in code.
**Mitigation:** refuse to start in production if `JWT_SECRET` equals the default. (Add to env validation.)

### 9.2 Default AGENT_TOKEN in repo — S1
**Same as 9.1.** Refuse to start in production if equals default.

### 9.3 Bcrypt rounds 10 acceptable; allow override to 12 in prod — S3
Already overridable.

### 9.4 No rate limit on /api/auth/login — S2
**Mitigation:** 5 attempts per minute per IP. `@fastify/rate-limit`.

### 9.5 No HTTPS in dev — N/A
nginx proxy handles in prod.

### 9.6 CORS `*` default — S2
**Mitigation:** require explicit `CORS_ORIGIN` in production.

---

## 10. Documentation / dev experience

### 10.1 README references env vars we are deleting — S3
**Mitigation:** PR updates `Agent/README.md`, root `README.md`, removes `SHOW_PREVIEW`, `MODEL_VERSION`, `CAMERA_ID`, `FRAME_FPS`, `FRAME_QUALITY` references. Adds note about hardcoded constants.

### 10.2 No e2e smoke test for "start agent → see frame" — S2
**Mitigation:** out of scope v1.

---

*End of edge cases. See `03-Rollout-and-Migration.md` for phasing & DB plan.*
