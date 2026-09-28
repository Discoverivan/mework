CREATE TABLE token_burner_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'stopping', 'target_reached', 'error', 'interrupted', 'completed')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    paused_at TEXT,
    accumulated_runtime_ms INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_runtime_ms >= 0),
    error TEXT
);

CREATE INDEX idx_token_burner_sessions_started_at
    ON token_burner_sessions(started_at);

CREATE TABLE token_burner_iterations (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL REFERENCES token_burner_sessions(id) ON DELETE CASCADE,
    integration_id TEXT NOT NULL,
    project_key TEXT NOT NULL,
    repository_slug TEXT NOT NULL,
    repository_name TEXT NOT NULL,
    pull_request_id TEXT NOT NULL,
    pull_request_title TEXT NOT NULL,
    pull_request_url TEXT,
    iteration INTEGER NOT NULL CHECK (iteration > 0),
    perspective TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('waiting', 'running', 'completed', 'failed')),
    phase TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    result_json TEXT,
    error TEXT
);

CREATE INDEX idx_token_burner_iterations_session_status
    ON token_burner_iterations(session_id, status, started_at);
CREATE INDEX idx_token_burner_iterations_started_at
    ON token_burner_iterations(started_at);
CREATE INDEX idx_token_burner_iterations_pr_perspective
    ON token_burner_iterations(integration_id, project_key, repository_slug, pull_request_id, perspective, started_at);
