ALTER TABLE stations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
UPDATE stations SET is_active = true WHERE is_active IS NULL;

INSERT INTO schema_migrations (version) VALUES (8)
ON CONFLICT (version) DO NOTHING;
