use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanningStatus {
    Draft,
    Applying,
    PartiallySynced,
    Locked,
    Conflict,
}

impl PlanningStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Applying => "applying",
            Self::PartiallySynced => "partially_synced",
            Self::Locked => "locked",
            Self::Conflict => "conflict",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Draft, Self::Applying)
                | (Self::Applying, Self::Locked)
                | (Self::Applying, Self::PartiallySynced)
                | (Self::Applying, Self::Conflict)
                | (Self::PartiallySynced, Self::Applying)
                | (Self::PartiallySynced, Self::Conflict)
                | (Self::Conflict, Self::Draft)
        )
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncActionStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Unknown,
}
impl SyncActionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedProject {
    pub id: String,
    pub integration_id: String,
    pub jira_project_id: String,
    pub jira_project_key: String,
    pub jira_project_name: String,
    pub board_id: Option<String>,
    pub source_sprint_id: Option<String>,
    pub source_sprint_name: Option<String>,
    pub story_points_field_id: Option<String>,
    pub competency_field_id: Option<String>,
    pub subtask_issue_type_id: Option<String>,
    pub default_team_preset_id: Option<String>,
    pub default_task_sprint_id: Option<String>,
    pub default_task_sprint_name: Option<String>,
    pub default_epic_link_key: Option<String>,
    pub default_epic_link_summary: Option<String>,
    pub epic_link_jql: String,
    pub enabled: bool,
    pub last_metadata_refresh_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub managed_project_id: String,
    pub source_sprint_id: Option<String>,
    pub target_sprint_id: String,
    pub revision: i64,
    pub status: PlanningStatus,
    pub remote_revision: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningItem {
    pub id: String,
    pub workspace_id: String,
    pub issue_id: String,
    pub issue_key: String,
    pub source_sprint_id: Option<String>,
    pub target_sprint_id: Option<String>,
    pub remote_updated_at: Option<String>,
    pub state: String,
    pub eligible: bool,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskPlan {
    pub id: String,
    pub planning_item_id: String,
    pub remote_subtask_id: Option<String>,
    pub competency_key: String,
    pub summary: String,
    pub story_points: Option<i64>,
    pub assignee_account_id: Option<String>,
    pub local_revision: i64,
    pub sync_status: String,
    pub locked: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamPreset {
    pub id: String,
    pub integration_id: String,
    pub jira_project_id: String,
    pub name: String,
    pub display_color: Option<String>,
    pub selected: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamMember {
    pub id: String,
    pub preset_id: String,
    pub account_id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub avatar_url: Option<String>,
    pub tags_json: String,
    pub active: bool,
    pub display_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAction {
    pub id: String,
    pub workspace_id: String,
    pub operation_type: String,
    pub idempotency_key: String,
    pub request_hash: String,
    pub status: SyncActionStatus,
    pub remote_issue_id: Option<String>,
    pub remote_sprint_id: Option<String>,
    pub remote_subtask_id: Option<String>,
    pub retry_count: i64,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub workspace_id: String,
    pub planning_item_id: Option<String>,
    pub action: String,
    pub previous_state: Option<String>,
    pub next_state: Option<String>,
    pub actor: String,
    pub remote_operation_id: Option<String>,
    pub occurred_at: String,
}
