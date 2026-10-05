ALTER TABLE token_burner_sessions
    ADD COLUMN ended_without_pull_requests INTEGER NOT NULL DEFAULT 0 CHECK (ended_without_pull_requests IN (0, 1));
