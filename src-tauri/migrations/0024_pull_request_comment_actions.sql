CREATE TABLE pull_request_comment_actions (
    idempotency_key TEXT PRIMARY KEY,
    request_json TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    comment_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
