CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_log (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  station_id text NOT NULL,
  timestamp timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_timestamp
  ON event_log(timestamp DESC);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  avatar text
);

CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY,
  part_name text NOT NULL,
  part_code text NOT NULL UNIQUE,
  vendor text NOT NULL,
  dimensions jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  event_id text NOT NULL,
  station_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  part_id text,
  part_name text NOT NULL,
  part_code text NOT NULL,
  vendor text,
  operator_id text,
  operator_name text,
  status text NOT NULL CHECK (status IN ('OK', 'NG')),
  confidence_score double precision NOT NULL,
  measurements jsonb NOT NULL,
  detections jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger text,
  frame_object_key text,
  frame_uploaded_at timestamptz
);

SELECT create_hypertable(
  'inspections', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => true
);

ALTER TABLE inspections SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'station_id,part_code'
);

CREATE INDEX IF NOT EXISTS idx_inspections_event_id
  ON inspections(event_id);
CREATE INDEX IF NOT EXISTS idx_inspections_timestamp
  ON inspections(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_status_part
  ON inspections(status, part_code);
CREATE INDEX IF NOT EXISTS idx_inspections_station_ts
  ON inspections(station_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_partcode_status_ts
  ON inspections(part_code, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_frame_uploaded
  ON inspections(frame_uploaded_at)
  WHERE frame_object_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS stations (
  station_id text PRIMARY KEY,
  event_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('online', 'offline')),
  fps double precision,
  running boolean NOT NULL DEFAULT false,
  phase text,
  active_part_code text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS quality_records (
  id text PRIMARY KEY,
  date date NOT NULL,
  part_code text NOT NULL,
  part_name text NOT NULL,
  vendor text NOT NULL,
  total_scanned integer NOT NULL DEFAULT 0,
  ng_count integer NOT NULL DEFAULT 0,
  ng_rate numeric(6, 2) NOT NULL DEFAULT 0,
  request_status text NOT NULL,
  status_history jsonb NOT NULL,
  UNIQUE (date, part_code)
);

CREATE INDEX IF NOT EXISTS idx_quality_records_date
  ON quality_records(date DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_aggregates_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', timestamp) AS bucket,
  station_id,
  part_code,
  part_name,
  COUNT(*) FILTER (WHERE status = 'OK')::bigint AS ok,
  COUNT(*) FILTER (WHERE status = 'NG')::bigint AS ng,
  COUNT(*)::bigint AS total
FROM inspections
GROUP BY bucket, station_id, part_code, part_name
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'dashboard_aggregates_daily',
  start_offset => INTERVAL '30 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => true
);

INSERT INTO schema_migrations (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;
