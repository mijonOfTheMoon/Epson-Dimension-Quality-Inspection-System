ALTER TABLE stations ADD COLUMN IF NOT EXISTS running boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version) VALUES (4)
ON CONFLICT (version) DO NOTHING;
