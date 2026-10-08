-- Persist the default Epic link selected from the configured Epic link JQL.
ALTER TABLE managed_projects ADD COLUMN default_epic_link_key TEXT;
ALTER TABLE managed_projects ADD COLUMN default_epic_link_summary TEXT;
