ALTER TABLE integrations ADD COLUMN checkpoint TEXT;

CREATE TABLE sync_runs (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    job_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    checkpoint_before TEXT,
    checkpoint_after TEXT,
    pages INTEGER NOT NULL DEFAULT 0,
    counters_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT
);

CREATE INDEX idx_sync_runs_integration_started
    ON sync_runs(integration_id, started_at);
CREATE INDEX idx_sync_runs_status
    ON sync_runs(status, started_at);
