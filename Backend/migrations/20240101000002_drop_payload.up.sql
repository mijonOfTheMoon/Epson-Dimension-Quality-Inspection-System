ALTER TABLE event_log    DROP COLUMN IF EXISTS payload;
ALTER TABLE inspections  DROP COLUMN IF EXISTS payload;
ALTER TABLE stations     DROP COLUMN IF EXISTS payload;
ALTER TABLE stations     DROP COLUMN IF EXISTS queue_size;
ALTER TABLE alerts       DROP COLUMN IF EXISTS payload;

INSERT INTO schema_migrations (version) VALUES (2)
ON CONFLICT (version) DO NOTHING;
