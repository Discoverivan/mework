CREATE TABLE jira_issues (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,
    title TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (integration_id, external_id)
);

CREATE INDEX idx_jira_issues_integration_updated
    ON jira_issues(integration_id, observed_at);
