-- Planning configuration, local drafts, team presets and auditable sync operations.
-- This migration is append-only; migrations 0001..0008 are intentionally unchanged.

CREATE TABLE managed_projects (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL,
    jira_project_id TEXT NOT NULL,
    jira_project_key TEXT NOT NULL,
    jira_project_name TEXT NOT NULL,
    board_id TEXT,
    source_sprint_id TEXT,
    source_sprint_name TEXT,
    story_points_field_id TEXT,
    competency_field_id TEXT,
    subtask_issue_type_id TEXT,
    default_team_preset_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    last_metadata_refresh_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_managed_projects_integration_project_board
        UNIQUE (integration_id, jira_project_id, board_id),
    CONSTRAINT fk_managed_projects_integration
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
);

CREATE TABLE planning_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    managed_project_id TEXT NOT NULL,
    source_sprint_id TEXT,
    target_sprint_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'applying', 'partially_synced', 'locked', 'conflict')),
    remote_revision TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT fk_planning_workspaces_managed_project
        FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE CASCADE
);

CREATE TABLE planning_items (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    issue_key TEXT NOT NULL,
    source_sprint_id TEXT,
    target_sprint_id TEXT,
    remote_updated_at TEXT,
    state TEXT NOT NULL DEFAULT 'eligible',
    eligible INTEGER NOT NULL DEFAULT 1 CHECK (eligible IN (0, 1)),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_planning_items_workspace_issue UNIQUE (workspace_id, issue_id),
    CONSTRAINT fk_planning_items_workspace
        FOREIGN KEY (workspace_id) REFERENCES planning_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE planning_subtask_plans (
    id TEXT PRIMARY KEY NOT NULL,
    planning_item_id TEXT NOT NULL,
    remote_subtask_id TEXT,
    competency_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    story_points INTEGER CHECK (story_points IS NULL OR story_points >= 0),
    assignee_account_id TEXT,
    local_revision INTEGER NOT NULL DEFAULT 1 CHECK (local_revision > 0),
    sync_status TEXT NOT NULL DEFAULT 'draft',
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT fk_planning_subtask_plans_item
        FOREIGN KEY (planning_item_id) REFERENCES planning_items(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_planning_subtask_plans_remote_subtask
    ON planning_subtask_plans(remote_subtask_id)
    WHERE remote_subtask_id IS NOT NULL;

CREATE TABLE planning_team_presets (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL,
    jira_project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_color TEXT,
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_planning_team_presets_scope_name UNIQUE (integration_id, jira_project_id, name),
    CONSTRAINT fk_planning_team_presets_integration
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
);

CREATE TABLE planning_team_members (
    id TEXT PRIMARY KEY NOT NULL,
    preset_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_planning_team_members_preset_account UNIQUE (preset_id, account_id),
    CONSTRAINT fk_planning_team_members_preset
        FOREIGN KEY (preset_id) REFERENCES planning_team_presets(id) ON DELETE CASCADE
);

CREATE TABLE planning_sync_actions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'unknown')),
    remote_issue_id TEXT,
    remote_sprint_id TEXT,
    remote_subtask_id TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_planning_sync_actions_idempotency UNIQUE (idempotency_key),
    CONSTRAINT fk_planning_sync_actions_workspace
        FOREIGN KEY (workspace_id) REFERENCES planning_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE planning_audit_events (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    planning_item_id TEXT,
    action TEXT NOT NULL,
    previous_state TEXT,
    next_state TEXT,
    actor TEXT NOT NULL,
    remote_operation_id TEXT,
    occurred_at TEXT NOT NULL,
    CONSTRAINT fk_planning_audit_events_workspace
        FOREIGN KEY (workspace_id) REFERENCES planning_workspaces(id) ON DELETE CASCADE,
    CONSTRAINT fk_planning_audit_events_item
        FOREIGN KEY (planning_item_id) REFERENCES planning_items(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uq_managed_projects_identity
    ON managed_projects(integration_id, jira_project_id, COALESCE(board_id, ''));

CREATE INDEX idx_managed_projects_enabled ON managed_projects(integration_id, enabled);
CREATE INDEX idx_planning_workspaces_project_updated ON planning_workspaces(managed_project_id, updated_at);
CREATE INDEX idx_planning_items_workspace_state ON planning_items(workspace_id, state, eligible);
CREATE INDEX idx_planning_subtask_plans_item ON planning_subtask_plans(planning_item_id);
CREATE INDEX idx_planning_team_presets_scope ON planning_team_presets(integration_id, jira_project_id);
CREATE INDEX idx_planning_sync_actions_workspace_status ON planning_sync_actions(workspace_id, status);
CREATE INDEX idx_planning_audit_events_workspace_time ON planning_audit_events(workspace_id, occurred_at);

CREATE TRIGGER planning_audit_events_immutable_update
BEFORE UPDATE ON planning_audit_events
BEGIN
    SELECT RAISE(ABORT, 'planning audit events are immutable');
END;

CREATE TRIGGER planning_audit_events_immutable_delete
BEFORE DELETE ON planning_audit_events
BEGIN
    SELECT RAISE(ABORT, 'planning audit events are immutable');
END;
