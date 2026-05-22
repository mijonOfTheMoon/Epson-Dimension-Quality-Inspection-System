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
  event_id text PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
  station_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  part_id text,
  part_name text NOT NULL,
  part_code text NOT NULL,
  batch_no text,
  vendor text,
  operator_id text,
  operator_name text,
  status text NOT NULL CHECK (status IN ('OK', 'NG')),
  shift text,
  confidence_score double precision NOT NULL,
  measurements jsonb NOT NULL,
  detections jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url text
);

CREATE TABLE IF NOT EXISTS stations (
  station_id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES event_log(event_id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('online', 'offline')),
  fps double precision,
  message text
);

CREATE TABLE IF NOT EXISTS alerts (
  event_id text PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
  station_id text NOT NULL,
  timestamp timestamptz NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message text NOT NULL,
  inspection_id text,
  part_code text
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

CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_timestamp ON inspections(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_status_part ON inspections(status, part_code);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_quality_records_date ON quality_records(date DESC);

INSERT INTO schema_migrations (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;
