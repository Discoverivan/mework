-- Keep the journal even if a team/integration is removed: an uncertain write
-- must never become retryable through local configuration changes.
CREATE TABLE jira_task_create_actions (
    operation_key TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'rejected', 'succeeded')),
    result_json TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
