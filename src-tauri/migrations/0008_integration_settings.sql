-- Restrict integration settings to the providers supported by the core.
CREATE TRIGGER integrations_validate_kind_insert
BEFORE INSERT ON integrations
WHEN NEW.kind NOT IN ('jira', 'bitbucket')
BEGIN
    SELECT RAISE(ABORT, 'unsupported integration kind');
END;

CREATE TRIGGER integrations_validate_kind_update
BEFORE UPDATE OF kind ON integrations
WHEN NEW.kind NOT IN ('jira', 'bitbucket')
BEGIN
    SELECT RAISE(ABORT, 'unsupported integration kind');
END;

CREATE UNIQUE INDEX idx_integrations_identity
    ON integrations(kind, base_url, account_key);
