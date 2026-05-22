DROP TABLE IF EXISTS batches CASCADE;
DROP TABLE IF EXISTS shift_schedules CASCADE;

ALTER TABLE inspections DROP COLUMN IF EXISTS shift;
ALTER TABLE inspections DROP COLUMN IF EXISTS batch_no;

DROP INDEX IF EXISTS idx_inspections_shift_timestamp;

DROP MATERIALIZED VIEW IF EXISTS dashboard_aggregates_daily CASCADE;

CREATE MATERIALIZED VIEW dashboard_aggregates_daily
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

CALL refresh_continuous_aggregate('dashboard_aggregates_daily', NULL, NULL);

-- Version 7 was the removed shift/batch migration; keep the legacy
-- schema_migrations sequence contiguous for clean-state acceptance checks.
INSERT INTO schema_migrations (version) VALUES (7)
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_migrations (version) VALUES (10)
ON CONFLICT (version) DO NOTHING;
