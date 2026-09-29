CREATE TABLE daily_issue_transition_actions (
    idempotency_key TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,
    transition_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'unknown')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_daily_issue_transition_actions_integration_issue
    ON daily_issue_transition_actions(integration_id, issue_key, created_at);
