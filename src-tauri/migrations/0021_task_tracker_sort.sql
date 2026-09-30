ALTER TABLE task_monitors
    ADD COLUMN sort_key TEXT NOT NULL DEFAULT 'updated'
        CHECK (sort_key IN ('issue', 'summary', 'status', 'updated', 'change'));

ALTER TABLE task_monitors
    ADD COLUMN sort_direction TEXT NOT NULL DEFAULT 'desc'
        CHECK (sort_direction IN ('asc', 'desc'));
