-- Existing installations have general.settings before this migration. A new
-- installation does not, so its first launch can establish the current version.
INSERT INTO settings (key, value_json, schema_version, created_at, updated_at)
SELECT 'release_notes.last_seen_version', '"0.0.0"', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'general.settings')
  AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'release_notes.last_seen_version');
