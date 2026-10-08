CREATE TABLE managed_project_confluence_spaces (
    id TEXT PRIMARY KEY NOT NULL,
    managed_project_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    space_key TEXT NOT NULL,
    space_name TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CONSTRAINT uq_managed_project_confluence_space
        UNIQUE (managed_project_id, integration_id, space_id),
    CONSTRAINT fk_managed_project_confluence_space_project
        FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_managed_project_confluence_space_integration
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_managed_project_primary_confluence_space
    ON managed_project_confluence_spaces(managed_project_id)
    WHERE is_primary = 1;
