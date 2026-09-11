CREATE TABLE workflows (
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    skill_key TEXT NOT NULL,
    input_schema_json TEXT NOT NULL,
    output_schema_json TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (key, version)
);

CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY NOT NULL,
    workflow_key TEXT NOT NULL,
    workflow_version INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    hermes_session_id TEXT,
    hermes_run_id TEXT,
    approval_id TEXT,
    attempt INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queue_started_at TEXT,
    timeout_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (workflow_key, workflow_version)
        REFERENCES workflows(key, version)
);

CREATE TABLE hermes_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    adapter TEXT NOT NULL,
    session_id TEXT,
    run_id TEXT,
    profile TEXT,
    last_event_cursor TEXT,
    raw_result_ref TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_workflow_runs_status_updated
    ON workflow_runs(status, updated_at);
CREATE INDEX idx_hermes_sessions_run
    ON hermes_sessions(workflow_run_id);
