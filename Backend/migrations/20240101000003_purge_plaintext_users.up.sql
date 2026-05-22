DELETE FROM users WHERE password IS NULL OR password NOT LIKE '$2%';

INSERT INTO schema_migrations (version) VALUES (3)
ON CONFLICT (version) DO NOTHING;
