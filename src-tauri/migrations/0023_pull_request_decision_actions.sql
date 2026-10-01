CREATE TABLE pull_request_decision_actions (
    idempotency_key TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL,
    project_key TEXT NOT NULL,
    repository_slug TEXT NOT NULL,
    pull_request_id TEXT NOT NULL,
    latest_commit TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
