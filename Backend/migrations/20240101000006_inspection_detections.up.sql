ALTER TABLE inspections DROP COLUMN IF EXISTS line;
ALTER TABLE inspections DROP COLUMN IF EXISTS model_version;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS detections jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE inspections SET station_id = 'Station 1' WHERE station_id = 'station-1';

ALTER TABLE stations DROP COLUMN IF EXISTS model_version;
UPDATE stations SET station_id = 'Station 1' WHERE station_id = 'station-1';

UPDATE event_log SET station_id = 'Station 1' WHERE station_id = 'station-1';

CREATE INDEX IF NOT EXISTS idx_inspections_station_timestamp ON inspections(station_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_shift_timestamp ON inspections(shift, timestamp DESC);

INSERT INTO schema_migrations (version) VALUES (6)
ON CONFLICT (version) DO NOTHING;
