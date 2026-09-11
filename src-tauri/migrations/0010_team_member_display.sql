-- Add user-facing team member display settings after the initial planning schema.
ALTER TABLE planning_team_members ADD COLUMN alias TEXT;
ALTER TABLE planning_team_members ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0);
