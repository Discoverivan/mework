CREATE TABLE integrations (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    account_key TEXT NOT NULL,
    credential_ref TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    allow_insecure_tls INTEGER NOT NULL DEFAULT 0 CHECK (allow_insecure_tls IN (0, 1)),
    account_display_name TEXT,
    health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'working', 'unavailable')),
    health_error TEXT,
    health_details TEXT,
    health_checked_at TEXT,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    last_success_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (kind, base_url, account_key)
);

CREATE TABLE subscriptions (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    filter_json TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
    importance TEXT NOT NULL,
    notification_policy_json TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
    muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_version TEXT NOT NULL,
    normalized_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (integration_id, object_type, external_id)
);

CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL,
    integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    external_id TEXT NOT NULL,
    event_kind TEXT NOT NULL,
    source_version TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    UNIQUE (integration_id, object_type, external_id, event_kind, source_version)
);

CREATE TABLE inbox_items (
    id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    reason TEXT NOT NULL,
    severity TEXT NOT NULL,
    action_kind TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (event_id, subscription_id)
);

CREATE INDEX idx_integrations_enabled ON integrations(enabled);
CREATE INDEX idx_subscriptions_integration ON subscriptions(integration_id);
CREATE INDEX idx_snapshots_integration_object ON snapshots(integration_id, object_type, external_id);
CREATE INDEX idx_events_integration_observed ON events(integration_id, observed_at);
CREATE INDEX idx_inbox_items_state ON inbox_items(read, done, archived);
