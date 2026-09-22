DROP TRIGGER integrations_validate_kind_insert;
DROP TRIGGER integrations_validate_kind_update;

CREATE TRIGGER integrations_validate_kind_insert
BEFORE INSERT ON integrations
WHEN NEW.kind NOT IN ('jira', 'bitbucket', 'confluence')
BEGIN
    SELECT RAISE(ABORT, 'unsupported integration kind');
END;

CREATE TRIGGER integrations_validate_kind_update
BEFORE UPDATE OF kind ON integrations
WHEN NEW.kind NOT IN ('jira', 'bitbucket', 'confluence')
BEGIN
    SELECT RAISE(ABORT, 'unsupported integration kind');
END;
