CREATE TABLE task_monitors (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    jql TEXT NOT NULL,
    schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('period', 'cron')),
    schedule_value TEXT NOT NULL,
    tracked_events_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    last_success_at TEXT,
    next_check_at_ms INTEGER,
    current_issue_count INTEGER NOT NULL DEFAULT 0,
    changes_after_last_check INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE task_monitor_issues (
    monitor_id TEXT NOT NULL REFERENCES task_monitors(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    assignee TEXT,
    updated TEXT,
    comment_count INTEGER NOT NULL DEFAULT 0,
    issue_url TEXT NOT NULL,
    present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
    last_change_type TEXT,
    last_change_description TEXT,
    last_changed_at TEXT,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (monitor_id, issue_key)
);

CREATE INDEX idx_task_monitors_due
    ON task_monitors(enabled, next_check_at_ms);
CREATE INDEX idx_task_monitor_issues_current
    ON task_monitor_issues(monitor_id, present, issue_key);
