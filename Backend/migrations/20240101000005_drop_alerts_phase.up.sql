DROP INDEX IF EXISTS idx_alerts_timestamp;
DROP TABLE IF EXISTS alerts;

ALTER TABLE inspections DROP COLUMN IF EXISTS image_url;
ALTER TABLE inspections DROP COLUMN IF EXISTS camera_id;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS trigger text;

ALTER TABLE stations DROP COLUMN IF EXISTS message;
ALTER TABLE stations DROP COLUMN IF EXISTS camera_id;
UPDATE stations SET state = 'offline' WHERE state = 'degraded';
ALTER TABLE stations DROP CONSTRAINT IF EXISTS stations_state_check;
ALTER TABLE stations ADD CONSTRAINT stations_state_check CHECK (state IN ('online', 'offline'));
ALTER TABLE stations ADD COLUMN IF NOT EXISTS phase text;
ALTER TABLE stations ADD COLUMN IF NOT EXISTS active_part_code text;

INSERT INTO schema_migrations (version) VALUES (5)
ON CONFLICT (version) DO NOTHING;
