-- Persist task-creation defaults per managed team/project.
-- Existing rows receive empty values and remain compatible with previous versions.

ALTER TABLE managed_projects ADD COLUMN default_task_sprint_id TEXT;
ALTER TABLE managed_projects ADD COLUMN default_task_sprint_name TEXT;
ALTER TABLE managed_projects ADD COLUMN epic_link_jql TEXT NOT NULL DEFAULT '';
