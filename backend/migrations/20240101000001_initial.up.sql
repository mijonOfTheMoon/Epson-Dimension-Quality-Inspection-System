CREATE SCHEMA IF NOT EXISTS partman;
CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

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
  frame_object_key text,
  frame_uploaded_at timestamptz
)
PARTITION BY RANGE (timestamp);

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM partman.part_config
    WHERE parent_table = 'public.inspections'
  ) THEN
    PERFORM partman.create_parent(
      p_parent_table := 'public.inspections',
      p_control := 'timestamp',
      p_type := 'range',
      p_interval := '7 days',
      p_premake := 8,
      p_start_partition := '2024-01-01 00:00:00+00'
    );
  END IF;
END $$;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'partman-maintenance'
  ) THEN
    PERFORM cron.schedule(
      'partman-maintenance',
      '@daily',
      $cron$call partman.run_maintenance_proc()$cron$
    );
  END IF;
END $$;

INSERT INTO schema_migrations (version) VALUES (1)
ON CONFLICT (version) DO NOTHING;
