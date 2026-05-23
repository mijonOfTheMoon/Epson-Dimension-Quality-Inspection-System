DROP MATERIALIZED VIEW IF EXISTS dashboard_aggregates_daily CASCADE;

CREATE MATERIALIZED VIEW dashboard_aggregates_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', timestamp, 'Asia/Jakarta') AS bucket,
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

INSERT INTO schema_migrations (version) VALUES (2)
ON CONFLICT (version) DO NOTHING;
