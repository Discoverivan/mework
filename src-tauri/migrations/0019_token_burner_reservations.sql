ALTER TABLE token_burner_sessions
    ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE token_burner_iterations
    ADD COLUMN reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0);
