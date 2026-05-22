CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_pkey;
CREATE INDEX IF NOT EXISTS idx_inspections_event_id ON inspections(event_id);

SELECT create_hypertable(
  'inspections', 'timestamp',
  chunk_time_interval => INTERVAL '7 days',
  migrate_data => true,
  if_not_exists => true
);

ALTER TABLE inspections SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'station_id,part_code'
);

CREATE MATERIALIZED VIEW IF NOT EXISTS dashboard_aggregates_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', timestamp) AS bucket,
  station_id, part_code, part_name,
  COUNT(*) FILTER (WHERE status='OK')::bigint AS ok,
  COUNT(*) FILTER (WHERE status='NG')::bigint AS ng,
  COUNT(*)::bigint AS total
FROM inspections
GROUP BY bucket, station_id, part_code, part_name
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'dashboard_aggregates_daily',
  start_offset => INTERVAL '30 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => true);

SELECT add_compression_policy(
  'inspections',
  compress_after => INTERVAL '30 days',
  if_not_exists => true);

CREATE INDEX IF NOT EXISTS idx_inspections_partcode_status_ts
  ON inspections (part_code, status, timestamp DESC);

INSERT INTO schema_migrations (version) VALUES (9)
ON CONFLICT (version) DO NOTHING;
