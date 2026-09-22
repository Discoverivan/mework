use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IntegrationKind {
    Jira,
    Bitbucket,
    Confluence,
}

impl IntegrationKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Jira => "jira",
            Self::Bitbucket => "bitbucket",
            Self::Confluence => "confluence",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationHealthStatus {
    Unknown,
    Working,
    Unavailable,
}

impl IntegrationHealthStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Working => "working",
            Self::Unavailable => "unavailable",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "working" => Self::Working,
            "unavailable" => Self::Unavailable,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integration {
    pub id: String,
    pub kind: IntegrationKind,
    pub base_url: String,
    pub account_key: String,
    pub credential_ref: String,
    pub enabled: bool,
    pub allow_insecure_tls: bool,
    pub account_display_name: Option<String>,
    pub health_status: IntegrationHealthStatus,
    pub health_error: Option<String>,
    pub health_details: Option<String>,
    pub health_checked_at: Option<String>,
    pub capabilities_json: String,
    pub last_success_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub id: String,
    pub integration_id: String,
    pub name: String,
    pub source: String,
    pub filter_json: String,
    pub interval_seconds: i64,
    pub importance: String,
    pub notification_policy_json: String,
    pub paused: bool,
    pub muted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: String,
    pub integration_id: String,
    pub object_type: String,
    pub external_id: String,
    pub source_version: String,
    pub normalized_json: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub integration_id: String,
    pub object_type: String,
    pub external_id: String,
    pub event_kind: String,
    pub source_version: String,
    pub diff_json: String,
    pub occurred_at: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub event_id: String,
    pub subscription_id: String,
    pub title: String,
    pub reason: String,
    pub severity: String,
    pub action_kind: String,
    pub read: bool,
    pub done: bool,
    pub saved: bool,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}
