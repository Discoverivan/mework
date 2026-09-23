ALTER TABLE task_monitors
    ADD COLUMN max_tracked_issues INTEGER NOT NULL DEFAULT 100 CHECK (max_tracked_issues BETWEEN 1 AND 10000);

ALTER TABLE task_monitors
    ADD COLUMN exceeds_limit INTEGER NOT NULL DEFAULT 0 CHECK (exceeds_limit IN (0, 1));
