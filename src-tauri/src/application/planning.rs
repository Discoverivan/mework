pub mod sync;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::application::confluence::ConfluenceSpaceDto;
use crate::domain::models::IntegrationKind;
use crate::domain::planning::models::{
    ManagedProject, ManagedProjectConfluenceSpace, PlanningItem, PlanningStatus, SubtaskPlan,
    SyncActionStatus, TeamMember, TeamPreset, Workspace,
};
use crate::domain::planning::state_machine::PlanningStateMachine;
use crate::infrastructure::credentials::keyring::{
    CredentialError, CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
};
use crate::infrastructure::db::{planning_repositories, repositories};
use crate::infrastructure::integrations::jira::{
    error::JiraError,
    models::JiraDeployment,
    planning::{
        JiraPlanningClient, PlanningBoard, PlanningCapabilities, PlanningIssue, PlanningSprint,
    },
    planning_write::{
        CreateSubtaskRequest, IssueUpdate, JiraPlanningTransport, JiraPlanningWriteClient,
        JiraPlanningWriteError, JiraRequestAuthenticator, JiraWriteErrorKind,
        ReqwestPlanningTransport, WriteFieldValidation,
    },
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProjectRequest {
    pub id: Option<String>,
    pub integration_id: String,
    pub jira_project_id: String,
    pub jira_project_key: String,
    pub jira_project_name: String,
    pub confluence_space: Option<ConfluenceSpaceDto>,
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
    #[serde(default)]
    pub epic_link_jql: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProjectBoardsRequest {
    pub integration_id: String,
    pub project_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraBoardDto {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub board_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraProjectValidationRequest {
    pub integration_id: String,
    pub project_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpicLinkJqlPreviewRequest {
    pub managed_project_id: String,
    pub jql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpicLinkJqlIssueDto {
    pub key: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraProjectValidationDto {
    pub project_id: String,
    pub project_key: String,
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProjectDto {
    pub id: String,
    pub integration_id: String,
    pub project_id: String,
    pub project_key: String,
    pub project_name: String,
    pub confluence_space: Option<ConfluenceSpaceDto>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningCapabilitiesDto {
    pub projects: bool,
    pub boards: bool,
    pub sprints: bool,
    pub sprint_issues: bool,
    pub assignable_users: bool,
    pub fields: bool,
    pub create_metadata: String,
    pub move_issues_max: Option<u32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningWorkspaceRecordDto {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningManagedProjectDto {
    pub id: String,
    pub integration_id: String,
    pub jira_project_id: String,
    pub name: String,
    pub board_id: String,
    pub board_name: String,
    pub source_sprint_id: Option<String>,
    pub source_sprint_name: Option<String>,
    pub story_points_field_id: Option<String>,
    pub default_task_sprint_id: Option<String>,
    pub default_task_sprint_name: Option<String>,
    pub default_epic_link_key: Option<String>,
    pub default_epic_link_summary: Option<String>,
    pub epic_link_jql: String,
    #[serde(default)]
    pub availability: PlanningAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSprintDto {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub state: String,
    pub usable: bool,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    #[serde(default)]
    pub availability: PlanningAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlanningAvailability {
    Available,
    Empty,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningAssigneeDto {
    pub account_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSubtaskDto {
    pub id: String,
    pub summary: String,
    pub competency: Option<String>,
    pub story_points: Option<i64>,
    pub assignee: Option<PlanningAssigneeDto>,
    pub sync_state: String,
    pub is_remote: bool,
    pub required: Option<bool>,
    pub local_revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningIssueDto {
    pub id: String,
    pub key: String,
    pub summary: String,
    pub status: String,
    pub story_points: Option<i64>,
    pub assignee: Option<PlanningAssigneeDto>,
    pub source_sprint_id: Option<String>,
    pub target_sprint_id: Option<String>,
    pub sync_state: String,
    pub subtasks: Vec<PlanningSubtaskDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSprintRequest {
    pub managed_project_id: String,
    pub source_sprint_id: String,
    pub target_sprint_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDraftSubtaskRequest {
    pub id: String,
    pub summary: String,
    pub competency: String,
    pub story_points: Option<i64>,
    pub assignee_account_id: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDraftRequest {
    pub id: Option<String>,
    pub workspace_id: String,
    pub parent_issue_id: String,
    pub subtasks: Vec<PlanningDraftSubtaskRequest>,
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDraftDto {
    pub id: String,
    pub workspace_id: String,
    pub parent_issue_id: String,
    pub subtasks: Vec<PlanningDraftSubtaskRequest>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningWorkspaceDto {
    pub id: String,
    pub managed_project: PlanningManagedProjectDto,
    pub source_sprint: PlanningSprintDto,
    pub target_sprint: PlanningSprintDto,
    pub source_issues: Vec<PlanningIssueDto>,
    pub target_issues: Vec<PlanningIssueDto>,
    pub drafts: Vec<PlanningDraftDto>,
    pub revision: String,
    pub status: PlanningStatus,
    pub loaded_at: String,
    pub read_state: PlanningAvailability,
    pub read_state_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamPresetInput {
    pub id: Option<String>,
    pub managed_project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub member_account_ids: Vec<String>,
    pub member_tags: Option<std::collections::HashMap<String, Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamPresetDto {
    pub id: String,
    pub managed_project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub member_account_ids: Vec<String>,
    pub member_tags: Option<std::collections::HashMap<String, Vec<String>>>,
    pub selected: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberDto {
    pub account_id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub avatar_url: Option<String>,
    pub active: bool,
    pub tags: Vec<String>,
    pub display_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberSearchRequest {
    pub managed_project_id: String,
    pub query: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberAddRequest {
    pub managed_project_id: String,
    pub account_id: String,
    pub display_name: String,
    pub alias: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberReorderRequest {
    pub managed_project_id: String,
    pub account_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAndLockRequest {
    pub workspace_id: String,
    pub expected_revision: String,
    pub idempotency_key: String,
    pub confirm: bool,
    pub force: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Box<crate::application::integration_error::IntegrationErrorDetails>>,
}

impl std::fmt::Display for PlanningCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for PlanningCommandError {}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum PlanningError {
    InvalidInput,
    Database,
    NotFound,
}
impl std::fmt::Display for PlanningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "invalid planning configuration",
            Self::Database => "planning database operation failed",
            Self::NotFound => "managed project was not found",
        })
    }
}
impl std::error::Error for PlanningError {}

pub async fn list_managed_projects(
    pool: &SqlitePool,
    integration_id: Option<&str>,
) -> Result<Vec<ManagedProjectDto>, PlanningError> {
    let projects = planning_repositories::list_managed_projects(pool, integration_id)
        .await
        .map_err(|_| PlanningError::Database)?;
    let mut result = Vec::with_capacity(projects.len());
    for project in projects {
        let space = planning_repositories::primary_confluence_space(pool, &project.id)
            .await
            .map_err(|_| PlanningError::Database)?;
        result.push(managed_project_dto(project, space)?);
    }
    Ok(result)
}

pub async fn validate_project_key(
    pool: &SqlitePool,
    request: JiraProjectValidationRequest,
) -> Result<JiraProjectValidationDto, PlanningCommandError> {
    let integration = repositories::get_integration(pool, &request.integration_id)
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    if integration.allow_insecure_tls {
        client_builder = client_builder.danger_accept_invalid_certs(true);
    }
    let http = client_builder.build().map_err(|_| {
        command_error(
            "transport_unavailable",
            "Jira transport is unavailable",
            true,
        )
    })?;
    let store = planning_credential_store(pool).await?;
    validate_project_key_with_dependencies(
        pool,
        request,
        store.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await
}

pub(crate) async fn validate_project_key_with_dependencies<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    request: JiraProjectValidationRequest,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<JiraProjectValidationDto, PlanningCommandError> {
    let project_key = request.project_key.trim();
    if request.integration_id.trim().is_empty() || project_key.is_empty() {
        return Err(command_error(
            "invalid_input",
            "Jira integration and project key are required",
            false,
        ));
    }
    let (client, _) =
        planning_read_client_for_integration(pool, &request.integration_id, keyring, transport)
            .await?;
    let project = match client.get_project(project_key).await {
        Ok(project) => project,
        Err(crate::infrastructure::integrations::jira::error::JiraError::Http {
            status: 404,
            ..
        }) => {
            return Err(command_error(
                "not_found",
                "Jira project key was not found",
                false,
            ));
        }
        Err(error) => return Err(map_read_error(error)),
    };
    Ok(JiraProjectValidationDto {
        project_id: project.id,
        project_key: project.key,
        project_name: project.name,
    })
}

pub async fn list_project_boards(
    pool: &SqlitePool,
    request: JiraProjectBoardsRequest,
) -> Result<Vec<JiraBoardDto>, PlanningCommandError> {
    let project_key = request.project_key.trim();
    if request.integration_id.trim().is_empty() || project_key.is_empty() {
        return Err(command_error(
            "invalid_input",
            "Jira integration and project key are required",
            false,
        ));
    }
    let integration = repositories::get_integration(pool, request.integration_id.trim())
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    let mut http_builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    if integration.allow_insecure_tls {
        http_builder = http_builder.danger_accept_invalid_certs(true);
    }
    let http = http_builder.build().map_err(|_| {
        command_error(
            "transport_unavailable",
            "Jira transport is unavailable",
            true,
        )
    })?;
    let keyring = planning_credential_store(pool).await?;
    let (client, _) = planning_read_client_for_integration(
        pool,
        integration.id.as_str(),
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await?;
    client
        .list_boards_for_project(project_key, 50)
        .await
        .map(|page| {
            page.values
                .into_iter()
                .map(|board: PlanningBoard| JiraBoardDto {
                    id: board.id,
                    name: board.name,
                    board_type: board.board_type,
                })
                .collect()
        })
        .map_err(|error| map_read_error_at(error, "list_project_boards", "/rest/agile/1.0/board"))
}

pub async fn save_managed_project(
    pool: &SqlitePool,
    request: ManagedProjectRequest,
) -> Result<ManagedProjectDto, PlanningError> {
    if request.integration_id.trim().is_empty()
        || request.jira_project_id.trim().is_empty()
        || request.jira_project_key.trim().is_empty()
        || request.jira_project_name.trim().is_empty()
    {
        return Err(PlanningError::InvalidInput);
    }
    repositories::get_integration(pool, &request.integration_id)
        .await
        .map_err(|_| PlanningError::InvalidInput)?;
    if let Some(space) = request.confluence_space.as_ref() {
        if space.integration_id.trim().is_empty()
            || space.space_id.trim().is_empty()
            || space.space_key.trim().is_empty()
            || space.space_name.trim().is_empty()
        {
            return Err(PlanningError::InvalidInput);
        }
        let integration = repositories::get_integration(pool, &space.integration_id)
            .await
            .map_err(|_| PlanningError::InvalidInput)?;
        if integration.kind != IntegrationKind::Confluence || !integration.enabled {
            return Err(PlanningError::InvalidInput);
        }
    }
    let id = request.id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let existing = planning_repositories::get_managed_project(pool, &id)
        .await
        .ok();
    let value = ManagedProject {
        id: id.clone(),
        integration_id: request.integration_id,
        jira_project_id: request.jira_project_id,
        jira_project_key: request.jira_project_key,
        jira_project_name: request.jira_project_name,
        board_id: request.board_id,
        source_sprint_id: request.source_sprint_id,
        source_sprint_name: request.source_sprint_name,
        story_points_field_id: request.story_points_field_id,
        competency_field_id: request.competency_field_id,
        subtask_issue_type_id: request.subtask_issue_type_id,
        default_team_preset_id: request.default_team_preset_id,
        default_task_sprint_id: request.default_task_sprint_id,
        default_task_sprint_name: request.default_task_sprint_name,
        default_epic_link_key: request.default_epic_link_key,
        default_epic_link_summary: request.default_epic_link_summary,
        epic_link_jql: request.epic_link_jql.trim().to_owned(),
        enabled: request.enabled,
        last_metadata_refresh_at: existing
            .as_ref()
            .and_then(|v| v.last_metadata_refresh_at.clone()),
        created_at: existing
            .as_ref()
            .map(|v| v.created_at.clone())
            .unwrap_or_default(),
        updated_at: existing
            .as_ref()
            .map(|v| v.updated_at.clone())
            .unwrap_or_default(),
    };
    if existing.is_some() {
        sqlx::query("UPDATE managed_projects SET integration_id=?,jira_project_id=?,jira_project_key=?,jira_project_name=?,board_id=?,source_sprint_id=?,source_sprint_name=?,story_points_field_id=?,competency_field_id=?,subtask_issue_type_id=?,default_team_preset_id=?,default_task_sprint_id=?,default_task_sprint_name=?,epic_link_jql=?,default_epic_link_key=?,default_epic_link_summary=?,enabled=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(&value.integration_id).bind(&value.jira_project_id).bind(&value.jira_project_key).bind(&value.jira_project_name).bind(&value.board_id).bind(&value.source_sprint_id).bind(&value.source_sprint_name).bind(&value.story_points_field_id).bind(&value.competency_field_id).bind(&value.subtask_issue_type_id).bind(&value.default_team_preset_id).bind(&value.default_task_sprint_id).bind(&value.default_task_sprint_name).bind(&value.epic_link_jql).bind(&value.default_epic_link_key).bind(&value.default_epic_link_summary).bind(value.enabled).bind(&value.id).execute(pool).await.map_err(|_| PlanningError::Database)?;
    } else {
        planning_repositories::insert_managed_project_with_database_timestamps(pool, &value)
            .await
            .map_err(|_| PlanningError::Database)?;
    }
    let confluence_space = request
        .confluence_space
        .map(|space| ManagedProjectConfluenceSpace {
            id: Uuid::now_v7().to_string(),
            managed_project_id: id.clone(),
            integration_id: space.integration_id,
            space_id: space.space_id,
            space_key: space.space_key,
            space_name: space.space_name,
            is_primary: true,
            created_at: String::new(),
            updated_at: String::new(),
        });
    planning_repositories::replace_primary_confluence_space(pool, confluence_space.as_ref(), &id)
        .await
        .map_err(|_| PlanningError::Database)?;
    let saved = planning_repositories::get_managed_project(pool, &id)
        .await
        .map_err(|_| PlanningError::Database)?;
    managed_project_dto(saved, confluence_space)
}

pub async fn delete_managed_project(pool: &SqlitePool, id: &str) -> Result<(), PlanningError> {
    if planning_repositories::delete_managed_project(pool, id)
        .await
        .map_err(|_| PlanningError::Database)?
    {
        Ok(())
    } else {
        Err(PlanningError::NotFound)
    }
}

pub fn planning_capabilities(deployment: JiraDeployment) -> PlanningCapabilitiesDto {
    capabilities_dto(JiraPlanningClient::capabilities(deployment))
}

pub async fn list_workspaces(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<PlanningWorkspaceRecordDto>, PlanningError> {
    planning_repositories::list_workspaces(pool, managed_project_id)
        .await
        .map_err(|_| PlanningError::Database)?
        .into_iter()
        .map(workspace_record_dto)
        .collect()
}

pub async fn list_planning_managed_projects(
    pool: &SqlitePool,
) -> Result<Vec<PlanningManagedProjectDto>, PlanningCommandError> {
    let values = planning_repositories::list_managed_projects(pool, None)
        .await
        .map_err(db_error)?;
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    list_planning_managed_projects_with_dependencies(
        pool,
        values,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await
}

pub async fn list_target_sprints(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<PlanningSprintDto>, PlanningCommandError> {
    if managed_project_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "managed project id is required",
            false,
        ));
    }
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    list_target_sprints_with_dependencies(
        pool,
        managed_project_id,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await
}

pub async fn preview_epic_link_jql(
    pool: &SqlitePool,
    request: EpicLinkJqlPreviewRequest,
) -> Result<Vec<EpicLinkJqlIssueDto>, PlanningCommandError> {
    let managed_project_id = request.managed_project_id.trim();
    let jql = request.jql.trim();
    if managed_project_id.is_empty() || jql.is_empty() {
        return Err(command_error(
            "invalid_input",
            "managed project id and Epic link JQL are required",
            false,
        ));
    }
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let (client, _) = planning_read_client(
        pool,
        &project,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await?;
    client
        .search_issue_summaries(jql, 50)
        .await
        .map(|issues| {
            issues
                .into_iter()
                .map(|issue| EpicLinkJqlIssueDto {
                    key: issue.key,
                    summary: issue.summary,
                })
                .collect()
        })
        .map_err(|error| map_read_error_at(error, "preview_epic_link_jql", "/rest/api/2/search"))
}

pub(crate) async fn list_target_sprints_with_dependencies<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    managed_project_id: &str,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<Vec<PlanningSprintDto>, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let board_id = project
        .board_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            command_error("missing_metadata", "Jira board metadata is required", false)
        })?;
    let (client, _) = planning_read_client(pool, &project, keyring, transport).await?;
    let page = client
        .list_usable_sprints(board_id, 50)
        .await
        .map_err(|error| {
            map_read_error_at(
                error,
                "list_usable_sprints",
                "/rest/agile/1.0/board/{board}/sprint",
            )
        })?;
    Ok(page
        .values
        .into_iter()
        .map(|sprint| PlanningSprintDto {
            id: sprint.id,
            board_id: board_id.to_owned(),
            name: sprint.name,
            state: sprint.state.to_ascii_lowercase(),
            usable: sprint.state.eq_ignore_ascii_case("FUTURE"),
            start_date: sprint.start_date,
            end_date: sprint.end_date,
            availability: PlanningAvailability::Available,
        })
        .collect())
}

pub async fn load_planning_workspace(
    pool: &SqlitePool,
    request: PlanningSprintRequest,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    if request.managed_project_id.trim().is_empty() || request.target_sprint_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "managed project and target sprint ids are required",
            false,
        ));
    }
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    let remote = load_planning_workspace_with_dependencies(
        pool,
        request.clone(),
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await;
    match remote {
        Err(error)
            if matches!(
                error.code.as_str(),
                "missing_credential" | "missing_metadata"
            ) =>
        {
            load_local_workspace(pool, request).await
        }
        other => other,
    }
}

async fn load_local_workspace(
    pool: &SqlitePool,
    request: PlanningSprintRequest,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let workspace = match planning_repositories::find_workspace_by_selection(
        pool,
        &request.managed_project_id,
        Some(&request.source_sprint_id),
        &request.target_sprint_id,
    )
    .await
    .map_err(db_error)?
    {
        Some(value) => value,
        None => {
            let value = Workspace {
                id: Uuid::now_v7().to_string(),
                managed_project_id: request.managed_project_id,
                source_sprint_id: Some(request.source_sprint_id),
                target_sprint_id: request.target_sprint_id,
                revision: 1,
                status: PlanningStatus::Draft,
                remote_revision: None,
                created_at: timestamp(),
                updated_at: timestamp(),
            };
            planning_repositories::insert_workspace(pool, &value)
                .await
                .map_err(db_error)?;
            value
        }
    };
    build_workspace(pool, project, workspace).await
}

pub(crate) async fn load_planning_workspace_with_dependencies<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    request: PlanningSprintRequest,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let board_id = project
        .board_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            command_error("missing_metadata", "Jira board metadata is required", false)
        })?;
    let (client, _) = planning_read_client(pool, &project, keyring, transport).await?;
    let sprints = client.list_sprints(board_id, 50).await.map_err(|error| {
        map_read_error_at(
            error,
            "list_sprints",
            "/rest/agile/1.0/board/{board}/sprint",
        )
    })?;
    let source_sprint = if request.source_sprint_id.trim().is_empty() {
        sprints
            .values
            .iter()
            .find(|value| value.state.eq_ignore_ascii_case("ACTIVE"))
            .cloned()
            .ok_or_else(|| {
                command_error(
                    "not_found",
                    "an active source sprint was not found on the configured board",
                    false,
                )
            })?
    } else {
        sprints
            .values
            .iter()
            .find(|value| value.id == request.source_sprint_id)
            .cloned()
            .ok_or_else(|| {
                command_error(
                    "not_found",
                    "source sprint was not found on the configured board",
                    false,
                )
            })?
    };
    let target_sprint = sprints
        .values
        .iter()
        .find(|value| value.id == request.target_sprint_id)
        .cloned()
        .ok_or_else(|| {
            command_error(
                "not_found",
                "target sprint was not found on the configured board",
                false,
            )
        })?;
    let source_issues = client
        .list_sprint_issues(&source_sprint.id, 50)
        .await
        .map_err(|error| {
            map_read_error_at(
                error,
                "list_source_sprint_issues",
                "/rest/agile/1.0/sprint/{sprint}/issue",
            )
        })?
        .values;
    let target_issues = client
        .list_sprint_issues(&target_sprint.id, 50)
        .await
        .map_err(|error| {
            map_read_error_at(
                error,
                "list_target_sprint_issues",
                "/rest/agile/1.0/sprint/{sprint}/issue",
            )
        })?
        .values;
    let workspace = match planning_repositories::find_workspace_by_selection(
        pool,
        &request.managed_project_id,
        Some(&request.source_sprint_id),
        &request.target_sprint_id,
    )
    .await
    .map_err(db_error)?
    {
        Some(value) => value,
        None => {
            let value = Workspace {
                id: Uuid::now_v7().to_string(),
                managed_project_id: request.managed_project_id.clone(),
                source_sprint_id: Some(request.source_sprint_id.clone()),
                target_sprint_id: request.target_sprint_id.clone(),
                revision: 1,
                status: PlanningStatus::Draft,
                remote_revision: None,
                created_at: timestamp(),
                updated_at: timestamp(),
            };
            planning_repositories::insert_workspace(pool, &value)
                .await
                .map_err(db_error)?;
            value
        }
    };
    build_remote_workspace(
        pool,
        project,
        workspace,
        source_sprint,
        target_sprint,
        source_issues,
        target_issues,
    )
    .await
}

pub async fn save_planning_draft(
    pool: &SqlitePool,
    request: PlanningDraftRequest,
) -> Result<PlanningDraftDto, PlanningCommandError> {
    validate_draft(&request)?;
    let workspace = planning_repositories::load_workspace(pool, &request.workspace_id)
        .await
        .map_err(|_| command_error("not_found", "planning workspace was not found", false))?;
    let existing =
        planning_repositories::get_planning_item(pool, &workspace.id, &request.parent_issue_id)
            .await
            .map_err(db_error)?;
    let now = timestamp();
    let item = PlanningItem {
        id: existing
            .as_ref()
            .map(|v| v.id.clone())
            .or(request.id.clone())
            .unwrap_or_else(|| Uuid::now_v7().to_string()),
        workspace_id: workspace.id.clone(),
        issue_id: request.parent_issue_id.clone(),
        issue_key: request.parent_issue_id.clone(),
        source_sprint_id: workspace.source_sprint_id.clone(),
        target_sprint_id: Some(workspace.target_sprint_id.clone()),
        remote_updated_at: None,
        state: "draft".into(),
        eligible: true,
        locked: false,
        created_at: existing
            .as_ref()
            .map(|v| v.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
    };
    planning_repositories::upsert_planning_item(pool, &item)
        .await
        .map_err(db_error)?;
    let plans = request
        .subtasks
        .iter()
        .map(|value| SubtaskPlan {
            id: value.id.clone(),
            planning_item_id: item.id.clone(),
            remote_subtask_id: None,
            competency_key: value.competency.clone(),
            summary: value.summary.clone(),
            story_points: value.story_points,
            assignee_account_id: value.assignee_account_id.clone(),
            local_revision: request.revision.unwrap_or(1).max(1),
            sync_status: "draft".into(),
            locked: false,
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .collect::<Vec<_>>();
    planning_repositories::replace_subtask_plans(pool, &item.id, &plans)
        .await
        .map_err(db_error)?;
    Ok(PlanningDraftDto {
        id: item.id,
        workspace_id: item.workspace_id,
        parent_issue_id: item.issue_id,
        subtasks: request.subtasks,
        revision: request.revision.unwrap_or(1).max(1),
    })
}

pub async fn remove_planning_draft(
    pool: &SqlitePool,
    draft_id: &str,
) -> Result<(), PlanningCommandError> {
    if draft_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "draft id is required",
            false,
        ));
    }
    if planning_repositories::delete_planning_item(pool, draft_id)
        .await
        .map_err(db_error)?
    {
        Ok(())
    } else {
        Err(command_error(
            "not_found",
            "planning draft was not found",
            false,
        ))
    }
}

pub async fn list_team_presets(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<TeamPresetDto>, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let values = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?;
    Ok(values
        .into_iter()
        .map(|(preset, members)| team_preset_dto(managed_project_id, preset, members))
        .collect())
}

pub async fn save_team_preset(
    pool: &SqlitePool,
    request: TeamPresetInput,
) -> Result<TeamPresetDto, PlanningCommandError> {
    if request.managed_project_id.trim().is_empty() || request.name.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "managed project id and preset name are required",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let existing = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?
    .into_iter()
    .find(|(value, _)| request.id.as_deref() == Some(value.id.as_str()));
    let now = timestamp();
    let preset = TeamPreset {
        id: request
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string()),
        integration_id: project.integration_id,
        jira_project_id: project.jira_project_id,
        name: request.name.trim().into(),
        display_color: request.color.clone(),
        selected: existing
            .as_ref()
            .map(|(value, _)| value.selected)
            .unwrap_or(false),
        created_at: existing
            .as_ref()
            .map(|(value, _)| value.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
    };
    let tags = request.member_tags.clone().unwrap_or_default();
    let members = request
        .member_account_ids
        .iter()
        .enumerate()
        .map(|(display_order, account_id)| TeamMember {
            id: Uuid::now_v7().to_string(),
            preset_id: preset.id.clone(),
            account_id: account_id.clone(),
            display_name: account_id.clone(),
            alias: None,
            avatar_url: None,
            tags_json: serde_json::to_string(&tags.get(account_id).cloned().unwrap_or_default())
                .unwrap_or_else(|_| "[]".into()),
            active: true,
            display_order: display_order as i64,
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .collect::<Vec<_>>();
    planning_repositories::upsert_team_preset(pool, &preset, &members)
        .await
        .map_err(db_error)?;
    Ok(team_preset_dto(
        &request.managed_project_id,
        preset,
        members,
    ))
}

pub async fn remove_team_preset(
    pool: &SqlitePool,
    preset_id: &str,
) -> Result<(), PlanningCommandError> {
    if preset_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "preset id is required",
            false,
        ));
    }
    if planning_repositories::delete_team_preset(pool, preset_id)
        .await
        .map_err(db_error)?
    {
        Ok(())
    } else {
        Err(command_error(
            "not_found",
            "team preset was not found",
            false,
        ))
    }
}

pub async fn list_configured_team_members(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let presets = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?;
    Ok(presets
        .into_iter()
        .find(|(preset, _)| preset.name == "Project team")
        .map(|(_, members)| members.into_iter().map(team_member_dto).collect())
        .unwrap_or_default())
}

pub async fn search_team_members(
    pool: &SqlitePool,
    request: TeamMemberSearchRequest,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    let query = request.query.trim();
    if query.chars().count() < 3 {
        return Err(command_error(
            "invalid_input",
            "Enter at least 3 characters to search Jira users",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let integration = repositories::get_integration(pool, &project.integration_id)
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    let mut http_builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    if integration.allow_insecure_tls {
        http_builder = http_builder.danger_accept_invalid_certs(true);
    }
    let http = http_builder.build().map_err(|_| {
        command_error(
            "transport_unavailable",
            "Jira transport is unavailable",
            true,
        )
    })?;
    let keyring = planning_credential_store(pool).await?;
    let (client, _) = planning_read_client(
        pool,
        &project,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await?;
    client
        .search_assignable_users(&project.jira_project_key, query, 20)
        .await
        .map(|members| {
            members
                .into_iter()
                .map(|member| TeamMemberDto {
                    account_id: member.account_id,
                    display_name: member.display_name,
                    alias: None,
                    avatar_url: member.avatar_url,
                    active: member.active.unwrap_or(true),
                    tags: Vec::new(),
                    display_order: 0,
                })
                .collect()
        })
        .map_err(|error| {
            map_read_error_at(
                error,
                "search_team_members",
                "/rest/api/2/user/assignable/search",
            )
        })
}

pub async fn add_team_member(
    pool: &SqlitePool,
    request: TeamMemberAddRequest,
) -> Result<TeamMemberDto, PlanningCommandError> {
    if request.managed_project_id.trim().is_empty()
        || request.account_id.trim().is_empty()
        || request.display_name.trim().is_empty()
        || request.role.trim().is_empty()
    {
        return Err(command_error(
            "invalid_input",
            "Managed project, Jira user, display name, and role are required",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let existing_presets = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?;
    let now = timestamp();
    let (mut preset, mut members) = existing_presets
        .into_iter()
        .find(|(value, _)| value.name == "Project team")
        .unwrap_or_else(|| {
            (
                TeamPreset {
                    id: Uuid::now_v7().to_string(),
                    integration_id: project.integration_id.clone(),
                    jira_project_id: project.jira_project_id.clone(),
                    name: "Project team".into(),
                    display_color: None,
                    selected: false,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
                Vec::new(),
            )
        });
    let tags_json = serde_json::to_string(&[request.role.trim()]).unwrap_or_else(|_| "[]".into());
    let alias = request
        .alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let member = if let Some(member) = members
        .iter_mut()
        .find(|member| member.account_id == request.account_id.trim())
    {
        member.display_name = request.display_name.trim().into();
        member.alias = alias;
        member.avatar_url = request.avatar_url.clone();
        member.tags_json = tags_json;
        member.active = true;
        member.updated_at = now.clone();
        member.clone()
    } else {
        let member = TeamMember {
            id: Uuid::now_v7().to_string(),
            preset_id: preset.id.clone(),
            account_id: request.account_id.trim().into(),
            display_name: request.display_name.trim().into(),
            alias,
            avatar_url: request.avatar_url.clone(),
            tags_json,
            active: true,
            display_order: members.len() as i64,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        members.push(member.clone());
        member
    };
    preset.updated_at = now;
    planning_repositories::upsert_team_preset(pool, &preset, &members)
        .await
        .map_err(db_error)?;
    Ok(team_member_dto(member))
}

pub async fn remove_team_member(
    pool: &SqlitePool,
    managed_project_id: &str,
    account_id: &str,
) -> Result<(), PlanningCommandError> {
    if managed_project_id.trim().is_empty() || account_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "Managed project and Jira user are required",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let existing_presets = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?;
    let (mut preset, mut members) = existing_presets
        .into_iter()
        .find(|(value, _)| value.name == "Project team")
        .ok_or_else(|| command_error("not_found", "team member was not found", false))?;
    let original_len = members.len();
    members.retain(|member| member.account_id != account_id.trim());
    if members.len() == original_len {
        return Err(command_error(
            "not_found",
            "team member was not found",
            false,
        ));
    }
    preset.updated_at = timestamp();
    planning_repositories::upsert_team_preset(pool, &preset, &members)
        .await
        .map_err(db_error)
}

pub async fn reorder_team_members(
    pool: &SqlitePool,
    request: TeamMemberReorderRequest,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    if request.managed_project_id.trim().is_empty() || request.account_ids.is_empty() {
        return Err(command_error(
            "invalid_input",
            "managed project id and team member order are required",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, &request.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let (preset, members) = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?
    .into_iter()
    .find(|(value, _)| value.name == "Project team")
    .ok_or_else(|| command_error("not_found", "team member was not found", false))?;
    let current_ids = members
        .iter()
        .map(|member| member.account_id.as_str())
        .collect::<BTreeSet<_>>();
    let requested_ids = request
        .account_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if current_ids.len() != request.account_ids.len() || requested_ids != current_ids {
        return Err(command_error(
            "invalid_input",
            "team member order must contain each configured member exactly once",
            false,
        ));
    }
    planning_repositories::reorder_team_members(pool, &preset.id, &request.account_ids)
        .await
        .map_err(db_error)?;
    let reordered = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?
    .into_iter()
    .find(|(value, _)| value.id == preset.id)
    .map(|(_, values)| values.into_iter().map(team_member_dto).collect())
    .unwrap_or_default();
    Ok(reordered)
}

pub async fn list_team_members(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    list_team_members_with_dependencies(
        pool,
        managed_project_id,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await
}

pub(crate) async fn list_team_members_with_dependencies<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    managed_project_id: &str,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let presets = planning_repositories::list_team_presets(
        pool,
        &project.integration_id,
        &project.jira_project_id,
    )
    .await
    .map_err(db_error)?;
    let (client, _) = planning_read_client(pool, &project, keyring, transport).await?;
    let remote = client
        .list_assignable_users(&project.jira_project_key, 50)
        .await
        .map_err(|error| {
            map_read_error_at(
                error,
                "list_team_members",
                "/rest/api/2/user/assignable/search",
            )
        })?;
    let mut tags = BTreeMap::new();
    let mut aliases = BTreeMap::new();
    let mut display_orders = BTreeMap::new();
    for (_, members) in presets {
        for member in members {
            let account_id = member.account_id;
            tags.entry(account_id.clone())
                .or_insert_with(|| serde_json::from_str(&member.tags_json).unwrap_or_default());
            if let Some(alias) = member.alias {
                aliases.insert(account_id.clone(), alias);
            }
            display_orders.insert(account_id, member.display_order);
        }
    }
    let mut result = remote
        .values
        .into_iter()
        .map(|member| {
            let account_id = member.account_id;
            TeamMemberDto {
                alias: aliases.remove(&account_id),
                display_order: display_orders.remove(&account_id).unwrap_or(i64::MAX),
                account_id: account_id.clone(),
                display_name: member.display_name,
                avatar_url: member.avatar_url,
                active: member.active.unwrap_or(true),
                tags: tags.remove(&account_id).unwrap_or_default(),
            }
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        left.display_order
            .cmp(&right.display_order)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });
    Ok(result)
}

const KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

pub async fn load_jira_avatar_data(
    pool: &SqlitePool,
    managed_project_id: &str,
    avatar_url: &str,
) -> Result<Option<String>, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    let integration = repositories::get_integration(pool, &project.integration_id)
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    let image_url = Url::parse(avatar_url)
        .map_err(|_| command_error("invalid_input", "avatar URL is invalid", false))?;
    let base_url = Url::parse(&integration.base_url)
        .map_err(|_| command_error("invalid_input", "Jira base URL is invalid", false))?;
    if image_url.scheme() != base_url.scheme()
        || image_url.host_str() != base_url.host_str()
        || !image_url.path().starts_with("/secure/useravatar")
    {
        return Err(command_error(
            "invalid_input",
            "avatar URL is outside the Jira avatar path",
            false,
        ));
    }
    let keyring = planning_credential_store(pool).await?;
    let secret = keyring
        .load(&integration.credential_ref)
        .map_err(map_credential_error)?;
    if secret.is_empty() {
        return Ok(None);
    }
    let mut builder = Client::builder().timeout(Duration::from_secs(10));
    if integration.allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let client = builder.build().map_err(|_| {
        command_error(
            "transport_unavailable",
            "avatar transport is unavailable",
            true,
        )
    })?;
    let response = client
        .get(image_url)
        .bearer_auth(secret)
        .send()
        .await
        .map_err(|_| command_error("remote_error", "Unable to load Jira avatar", true))?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_owned();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| command_error("remote_error", "Unable to read Jira avatar", true))?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Ok(None);
    }
    Ok(Some(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )))
}

pub(crate) async fn planning_credential_store(
    pool: &SqlitePool,
) -> Result<Box<dyn CredentialStore>, PlanningCommandError> {
    let _ = pool;
    Ok(Box::new(OsKeyring::new(KEYRING_SERVICE)))
}

pub async fn apply_and_lock(
    pool: &SqlitePool,
    request: ApplyAndLockRequest,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    let keyring = planning_credential_store(pool).await?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    let transport: Arc<dyn JiraPlanningTransport> = Arc::new(ReqwestPlanningTransport::new(http));
    apply_and_lock_with_dependencies(pool, request, keyring.as_ref(), transport).await
}

/// Dependency-injected boundary used by focused tests. Production always calls
/// `apply_and_lock`, which supplies the OS keyring and reqwest transport.
pub(crate) async fn apply_and_lock_with_dependencies<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    request: ApplyAndLockRequest,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    if !request.confirm {
        return Err(command_error(
            "confirmation_required",
            "confirm must be true before Apply and lock",
            false,
        ));
    }
    let expected_revision = request
        .expected_revision
        .parse::<i64>()
        .ok()
        .filter(|revision| *revision >= 0)
        .ok_or_else(|| {
            command_error(
                "invalid_input",
                "expectedRevision must be a non-negative integer",
                false,
            )
        })?;
    if request.workspace_id.trim().is_empty() || request.idempotency_key.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "workspaceId and idempotencyKey are required",
            false,
        ));
    }

    let workspace = planning_repositories::load_workspace(pool, &request.workspace_id)
        .await
        .map_err(|_| command_error("not_found", "planning workspace was not found", false))?;
    if expected_revision != workspace.revision {
        if let Some(existing) =
            planning_repositories::find_sync_action_by_idempotency(pool, &request.idempotency_key)
                .await
                .map_err(|_| {
                    command_error("database", "planning database operation failed", true)
                })?
        {
            if existing.workspace_id == workspace.id
                && existing.status == SyncActionStatus::Succeeded
            {
                let project =
                    planning_repositories::get_managed_project(pool, &workspace.managed_project_id)
                        .await
                        .map_err(|_| {
                            command_error("not_found", "managed project was not found", false)
                        })?;
                return build_workspace(pool, project, workspace).await;
            }
        }
        return Err(command_error(
            "conflict",
            "planning workspace revision is stale",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, &workspace.managed_project_id)
        .await
        .map_err(|_| command_error("not_found", "managed project was not found", false))?;
    if !project.enabled {
        return Err(command_error(
            "capability_unavailable",
            "managed project is disabled",
            false,
        ));
    }
    let integration = repositories::get_integration(pool, &project.integration_id)
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    if !integration.enabled || integration.kind != crate::domain::models::IntegrationKind::Jira {
        return Err(command_error(
            "capability_unavailable",
            "Jira integration is disabled",
            false,
        ));
    }

    let items = planning_repositories::list_planning_items(pool, &workspace.id)
        .await
        .map_err(|_| command_error("database", "planning database operation failed", true))?;
    let mut item_plans = Vec::with_capacity(items.len());
    let mut draft = sync::PlanningDraft::default();
    for item in items {
        let subtasks = planning_repositories::list_subtask_plans(pool, &item.id)
            .await
            .map_err(|_| command_error("database", "planning database operation failed", true))?;
        draft.parents.push(sync::ParentDraft {
            issue_id: item.issue_id.clone(),
            source_sprint_id: item
                .source_sprint_id
                .clone()
                .or_else(|| workspace.source_sprint_id.clone())
                .ok_or_else(|| {
                    command_error(
                        "missing_metadata",
                        "source sprint metadata is required",
                        false,
                    )
                })?,
            target_sprint_id: item
                .target_sprint_id
                .clone()
                .unwrap_or_else(|| workspace.target_sprint_id.clone()),
            assignee_account_id: None,
            selected: item.eligible && !item.locked,
        });
        for subtask in &subtasks {
            draft.subtasks.push(sync::SubtaskDraft {
                remote_subtask_id: subtask.remote_subtask_id.clone(),
                parent_issue_id: item.issue_id.clone(),
                competency_key: subtask.competency_key.clone(),
                summary: subtask.summary.clone(),
                story_points: subtask.story_points,
                assignee_account_id: subtask.assignee_account_id.clone(),
                required: !subtask.locked,
            });
        }
        item_plans.push((item, subtasks));
    }
    let plan =
        sync::plan_operations(&draft, sync::DEFAULT_MOVE_CHUNK_SIZE).map_err(sync_error_command)?;

    if let Some(existing) =
        planning_repositories::find_sync_action_by_idempotency(pool, &request.idempotency_key)
            .await
            .map_err(|_| command_error("database", "planning database operation failed", true))?
    {
        if existing.workspace_id != workspace.id || existing.request_hash != plan.request_hash {
            return Err(command_error(
                "idempotency_conflict",
                "idempotency key was already used for another request",
                false,
            ));
        }
        if existing.status == SyncActionStatus::Succeeded {
            return build_workspace(pool, project, workspace).await;
        }
        return Err(command_error(
            "retry_required",
            "a previous Jira write did not complete; reconcile it before retrying",
            true,
        ));
    }

    let deployment = deployment_from_capabilities(&integration.capabilities_json)?;
    validate_project_metadata(&project, &workspace, &draft, deployment)?;
    let secret = keyring
        .load(&integration.credential_ref)
        .map_err(map_credential_error)?;
    if secret.is_empty() {
        return Err(command_error(
            "missing_credential",
            "Jira credential is missing",
            false,
        ));
    }
    let authenticator: Arc<dyn JiraRequestAuthenticator> = Arc::new(BasicJiraAuthenticator {
        account_key: integration.account_key.clone(),
        secret,
    });
    let client =
        JiraPlanningWriteClient::new(&integration.base_url, transport, authenticator, deployment)
            .map_err(map_jira_setup_error)?;
    let capabilities = adapter_capabilities(&project, deployment);

    let applying =
        planning_repositories::mark_workspace_applying(pool, &workspace.id, workspace.revision)
            .await
            .map_err(|error| {
                if matches!(error, sqlx::Error::Protocol(_)) {
                    command_error("conflict", "planning workspace revision is stale", false)
                } else {
                    command_error("database", "planning database operation failed", true)
                }
            })?;

    let sync_request = sync::ApplyRequest {
        workspace_id: workspace.id.clone(),
        expected_revision: workspace.revision,
        expected_remote_revision: workspace.remote_revision.clone(),
        confirm: request.confirm,
        idempotency_key: request.idempotency_key.clone(),
        draft,
    };
    let coordinator = sync::SyncCoordinator::new(PlanningStateMachine::from_parts(
        sync::PlanningState::Draft,
        workspace.revision,
        workspace.remote_revision.clone(),
    ));
    let adapter = BlockingJiraPlanningWriteAdapter::new(client, capabilities, project.clone())
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Jira transport is unavailable",
                true,
            )
        })?;
    let apply_result = tokio::task::spawn_blocking(move || {
        let mut coordinator = coordinator;
        let mut adapter = adapter;
        coordinator.apply(sync_request, Some(&mut adapter))
    })
    .await
    .map_err(|_| command_error("transport_unavailable", "Jira write worker stopped", true))?
    .map_err(sync_error_command)?;

    persist_apply(
        pool,
        &workspace,
        &applying,
        &item_plans,
        &plan,
        &apply_result,
        &request.idempotency_key,
    )
    .await?;

    if apply_result.state != sync::PlanningState::Locked {
        return Err(command_from_apply_result(&apply_result));
    }
    let refreshed = planning_repositories::load_workspace(pool, &workspace.id)
        .await
        .map_err(|_| command_error("database", "planning database operation failed", true))?;
    build_workspace(pool, project, refreshed).await
}

struct BasicJiraAuthenticator {
    account_key: String,
    secret: String,
}

impl JiraRequestAuthenticator for BasicJiraAuthenticator {
    fn authenticate(
        &self,
        request: RequestBuilder,
    ) -> Result<RequestBuilder, JiraPlanningWriteError> {
        Ok(request.basic_auth(&self.account_key, Some(&self.secret)))
    }
}

fn deployment_from_capabilities(value: &str) -> Result<JiraDeployment, PlanningCommandError> {
    let parsed: Value = serde_json::from_str(value).map_err(|_| {
        command_error(
            "missing_metadata",
            "Jira deployment metadata is missing",
            false,
        )
    })?;
    let deployment = parsed
        .get("deployment")
        .or_else(|| parsed.get("jiraDeployment"))
        .and_then(Value::as_str)
        .map(|value| value.to_ascii_lowercase());
    match deployment.as_deref() {
        Some("cloud") => Ok(JiraDeployment::Cloud),
        Some("data_center") | Some("datacenter") => Ok(JiraDeployment::DataCenter),
        _ => Err(command_error(
            "missing_metadata",
            "Jira deployment metadata is missing or unsupported",
            false,
        )),
    }
}

fn validate_project_metadata(
    project: &ManagedProject,
    workspace: &Workspace,
    draft: &sync::PlanningDraft,
    deployment: JiraDeployment,
) -> Result<(), PlanningCommandError> {
    if deployment != JiraDeployment::Cloud {
        return Err(command_error(
            "unsupported_capability",
            "Jira planning writes require Jira Cloud",
            false,
        ));
    }
    if project.jira_project_id.trim().is_empty()
        || project.board_id.as_deref().is_none_or(str::is_empty)
        || workspace.target_sprint_id.trim().is_empty()
        || draft
            .parents
            .iter()
            .filter(|parent| parent.selected)
            .any(|parent| parent.source_sprint_id.trim().is_empty())
    {
        return Err(command_error(
            "missing_metadata",
            "Jira project, board, source sprint, and target sprint metadata are required",
            false,
        ));
    }
    if draft.subtasks.iter().any(|subtask| subtask.required)
        && (project
            .story_points_field_id
            .as_deref()
            .is_none_or(str::is_empty)
            || project
                .competency_field_id
                .as_deref()
                .is_none_or(str::is_empty)
            || project
                .subtask_issue_type_id
                .as_deref()
                .is_none_or(str::is_empty))
    {
        return Err(command_error(
            "missing_metadata",
            "subtask issue type, story-points field, and competency field metadata are required",
            false,
        ));
    }
    Ok(())
}

fn adapter_capabilities(
    project: &ManagedProject,
    deployment: JiraDeployment,
) -> sync::WriteCapabilities {
    let editable_field_ids = [
        Some("assignee".to_owned()),
        project.story_points_field_id.clone(),
        project.competency_field_id.clone(),
    ]
    .into_iter()
    .flatten()
    .collect();
    let cloud = deployment == JiraDeployment::Cloud;
    sync::WriteCapabilities {
        can_move_issues: cloud,
        can_edit_issues: cloud,
        can_create_subtasks: cloud,
        move_issues_max: cloud.then_some(50),
        editable_field_ids,
    }
}

fn map_credential_error(error: CredentialError) -> PlanningCommandError {
    match error {
        CredentialError::NotFound => {
            command_error("missing_credential", "Jira credential is missing", false)
        }
        CredentialError::Backend | CredentialError::Database => command_error(
            "credential_unavailable",
            "Jira credential store is unavailable",
            true,
        ),
    }
}

fn map_jira_setup_error(error: JiraPlanningWriteError) -> PlanningCommandError {
    match error.kind() {
        JiraWriteErrorKind::UnsupportedCapability => command_error(
            "unsupported_capability",
            "Jira planning write capability is unavailable",
            false,
        ),
        JiraWriteErrorKind::InvalidRequest => command_error(
            "invalid_metadata",
            "Jira integration metadata is invalid",
            false,
        ),
        _ => command_error(
            "transport_unavailable",
            "Jira write client is unavailable",
            true,
        ),
    }
}

struct BlockingJiraPlanningWriteAdapter {
    runtime: tokio::runtime::Runtime,
    client: Arc<JiraPlanningWriteClient>,
    capabilities: sync::WriteCapabilities,
    project: ManagedProject,
}

impl BlockingJiraPlanningWriteAdapter {
    fn new(
        client: JiraPlanningWriteClient,
        capabilities: sync::WriteCapabilities,
        project: ManagedProject,
    ) -> Result<Self, std::io::Error> {
        Ok(Self {
            runtime: tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?,
            client: Arc::new(client),
            capabilities,
            project,
        })
    }

    fn fields(&self, competency: &str, story_points: Option<i64>) -> BTreeMap<String, Value> {
        let mut fields = BTreeMap::new();
        if let Some(field_id) = &self.project.competency_field_id {
            fields.insert(field_id.clone(), Value::String(competency.to_owned()));
        }
        if let (Some(field_id), Some(points)) = (&self.project.story_points_field_id, story_points)
        {
            fields.insert(field_id.clone(), json!(points));
        }
        fields
    }

    fn run<T>(&self, future: impl std::future::Future<Output = T>) -> T {
        self.runtime.block_on(future)
    }

    fn write_one(
        &mut self,
        operation: &sync::PlannedOperation,
    ) -> Result<sync::RemoteWrite, sync::WriteError> {
        let client = self.client.clone();
        let project = self.project.clone();
        let result = match operation {
            sync::PlannedOperation::MoveIssue {
                target_sprint_id,
                issue_id,
                ..
            } => self
                .run(async move {
                    client
                        .move_issues_to_sprint(target_sprint_id, std::slice::from_ref(issue_id))
                        .await
                        .map(|_| target_sprint_id.clone())
                })
                .map(|remote_reference| sync::RemoteWrite {
                    remote_reference: Some(remote_reference),
                }),
            sync::PlannedOperation::UpdateParentAssignee {
                issue_id,
                account_id,
            } => self
                .run(async move {
                    client
                        .update_issue(
                            issue_id,
                            IssueUpdate {
                                assignee_account_id: Some(Some(account_id.clone())),
                                fields: BTreeMap::new(),
                            },
                            &BTreeSet::from(["assignee".to_owned()]),
                        )
                        .await
                        .map(|_| issue_id.clone())
                })
                .map(|remote_reference| sync::RemoteWrite {
                    remote_reference: Some(remote_reference),
                }),
            sync::PlannedOperation::CreateSubtask {
                parent_issue_id,
                competency_key,
                summary,
                story_points,
                assignee_account_id,
            } => {
                let fields = self.fields(competency_key, *story_points);
                let validation = WriteFieldValidation {
                    allowed_fields: fields
                        .keys()
                        .cloned()
                        .chain(std::iter::once("assignee".to_owned()))
                        .collect(),
                    required_fields: BTreeSet::new(),
                };
                let parent = parent_issue_id.clone();
                let summary = summary.clone();
                let issue_type_id = project.subtask_issue_type_id.clone().unwrap_or_default();
                let project_id = project.jira_project_id.clone();
                let assignee = assignee_account_id.clone();
                self.run(async move {
                    let created = client
                        .create_subtask(
                            CreateSubtaskRequest {
                                parent_issue_id_or_key: parent,
                                project_id,
                                issue_type_id,
                                summary,
                                fields,
                            },
                            &validation,
                        )
                        .await?;
                    if let Some(account_id) = assignee {
                        client
                            .update_issue(
                                &created.issue.key,
                                IssueUpdate {
                                    assignee_account_id: Some(Some(account_id)),
                                    fields: BTreeMap::new(),
                                },
                                &BTreeSet::from(["assignee".to_owned()]),
                            )
                            .await?;
                    }
                    Ok::<_, JiraPlanningWriteError>(created.issue.id)
                })
                .map(|remote_reference| sync::RemoteWrite {
                    remote_reference: Some(remote_reference),
                })
            }
            sync::PlannedOperation::UpdateSubtask {
                remote_subtask_id,
                parent_issue_id,
                competency_key,
                story_points,
                assignee_account_id,
                ..
            } => {
                let fields = self.fields(competency_key, *story_points);
                let issue_id = remote_subtask_id.clone();
                let parent = parent_issue_id.clone();
                self.run(async move {
                    client
                        .update_subtask(
                            &issue_id,
                            &parent,
                            IssueUpdate {
                                assignee_account_id: assignee_account_id.clone().map(Some),
                                fields,
                            },
                            &BTreeSet::from_iter([
                                "assignee".to_owned(),
                                project.story_points_field_id.unwrap_or_default(),
                                project.competency_field_id.unwrap_or_default(),
                            ]),
                        )
                        .await
                        .map(|_| issue_id)
                })
                .map(|remote_reference| sync::RemoteWrite {
                    remote_reference: Some(remote_reference),
                })
            }
            sync::PlannedOperation::UpdateField {
                issue_id,
                field_id,
                value,
            } => {
                let field_id = field_id.clone();
                let issue_id = issue_id.clone();
                let value = value.clone();
                let allowed_field = field_id.clone();
                self.run(async move {
                    client
                        .update_issue(
                            &issue_id,
                            IssueUpdate {
                                assignee_account_id: None,
                                fields: BTreeMap::from([(field_id, Value::String(value))]),
                            },
                            &BTreeSet::from_iter([allowed_field]),
                        )
                        .await
                        .map(|_| issue_id)
                })
                .map(|remote_reference| sync::RemoteWrite {
                    remote_reference: Some(remote_reference),
                })
            }
        };
        result.map_err(map_write_error)
    }
}

impl sync::JiraPlanningWriteAdapter for BlockingJiraPlanningWriteAdapter {
    fn capabilities(&self) -> &sync::WriteCapabilities {
        &self.capabilities
    }

    fn write(
        &mut self,
        operation: &sync::PlannedOperation,
    ) -> Result<sync::RemoteWrite, sync::WriteError> {
        self.write_one(operation)
    }

    fn write_batch(
        &mut self,
        operations: &[sync::PlannedOperation],
    ) -> Vec<Result<sync::RemoteWrite, sync::WriteError>> {
        if operations.is_empty()
            || !operations
                .iter()
                .all(|operation| matches!(operation, sync::PlannedOperation::MoveIssue { .. }))
        {
            return operations
                .iter()
                .map(|operation| self.write_one(operation))
                .collect();
        }
        let target = match &operations[0] {
            sync::PlannedOperation::MoveIssue {
                target_sprint_id, ..
            } => target_sprint_id.clone(),
            _ => unreachable!(),
        };
        let issue_ids = operations
            .iter()
            .map(|operation| match operation {
                sync::PlannedOperation::MoveIssue { issue_id, .. } => issue_id.clone(),
                _ => unreachable!(),
            })
            .collect::<Vec<_>>();
        match self.run(self.client.move_issues_to_sprint(&target, &issue_ids)) {
            Ok(_) => operations
                .iter()
                .map(|_| {
                    Ok(sync::RemoteWrite {
                        remote_reference: Some(target.clone()),
                    })
                })
                .collect(),
            Err(error) => {
                let completed = error.completed_issue_ids().to_vec();
                let mapped = map_write_error(error);
                operations
                    .iter()
                    .map(|operation| match operation {
                        sync::PlannedOperation::MoveIssue { issue_id, .. }
                            if completed
                                .iter()
                                .any(|completed_id| completed_id == issue_id) =>
                        {
                            Ok(sync::RemoteWrite {
                                remote_reference: Some(target.clone()),
                            })
                        }
                        _ => Err(mapped),
                    })
                    .collect()
            }
        }
    }

    fn reconcile(&mut self, operation: &sync::PlannedOperation) -> sync::Reconciliation {
        let client = self.client.clone();
        match operation {
            sync::PlannedOperation::MoveIssue {
                issue_id,
                target_sprint_id,
                ..
            } => self
                .run(client.issue_in_sprint(target_sprint_id, issue_id))
                .map(|applied| {
                    if applied {
                        sync::Reconciliation::Applied {
                            remote_reference: target_sprint_id.clone(),
                        }
                    } else {
                        sync::Reconciliation::NotApplied
                    }
                })
                .unwrap_or(sync::Reconciliation::Unknown),
            sync::PlannedOperation::CreateSubtask {
                parent_issue_id,
                summary,
                ..
            } => self
                .run(client.subtask_exists(parent_issue_id, summary))
                .map(|reference| {
                    reference.map_or(sync::Reconciliation::NotApplied, |remote_reference| {
                        sync::Reconciliation::Applied { remote_reference }
                    })
                })
                .unwrap_or(sync::Reconciliation::Unknown),
            sync::PlannedOperation::UpdateParentAssignee { issue_id, .. }
            | sync::PlannedOperation::UpdateSubtask {
                remote_subtask_id: issue_id,
                ..
            }
            | sync::PlannedOperation::UpdateField { issue_id, .. } => self
                .run(client.issue_exists(issue_id))
                .map(|applied| {
                    if applied {
                        sync::Reconciliation::Applied {
                            remote_reference: issue_id.clone(),
                        }
                    } else {
                        sync::Reconciliation::NotApplied
                    }
                })
                .unwrap_or(sync::Reconciliation::Unknown),
        }
    }
}

fn map_write_error(error: JiraPlanningWriteError) -> sync::WriteError {
    match error.kind() {
        JiraWriteErrorKind::PermissionDenied | JiraWriteErrorKind::AuthenticationRequired => {
            sync::WriteError::PermissionDenied
        }
        JiraWriteErrorKind::ValidationFailed
        | JiraWriteErrorKind::InvalidRequest
        | JiraWriteErrorKind::InvalidResponse
        | JiraWriteErrorKind::NotFound => sync::WriteError::Validation,
        JiraWriteErrorKind::RemoteConflict => sync::WriteError::RemoteConflict,
        JiraWriteErrorKind::UnsupportedCapability => sync::WriteError::Unavailable,
        JiraWriteErrorKind::Timeout => sync::WriteError::Timeout,
        JiraWriteErrorKind::RateLimited => sync::WriteError::Unavailable,
        JiraWriteErrorKind::Transport => sync::WriteError::Transport,
    }
}

fn sync_error_command(error: sync::SyncError) -> PlanningCommandError {
    match error {
        sync::SyncError::ConfirmationRequired => command_error(
            "confirmation_required",
            "confirm must be true before Apply and lock",
            false,
        ),
        sync::SyncError::MissingIdempotencyKey => {
            command_error("invalid_input", "idempotencyKey is required", false)
        }
        sync::SyncError::InvalidInput => {
            command_error("invalid_input", "invalid planning apply input", false)
        }
        sync::SyncError::CapabilityUnavailable => command_error(
            "capability_unavailable",
            "Jira planning write capability is unavailable",
            false,
        ),
        sync::SyncError::PermissionDenied => command_error(
            "permission_denied",
            "Jira planning write permission denied",
            false,
        ),
        sync::SyncError::MetadataValidation => command_error(
            "invalid_metadata",
            "Jira planning metadata validation failed",
            false,
        ),
        sync::SyncError::IdempotencyConflict => command_error(
            "idempotency_conflict",
            "idempotency key was already used for another request",
            false,
        ),
        sync::SyncError::StaleRevision { .. } | sync::SyncError::StaleRemoteRevision => {
            command_error("conflict", "planning revision is stale", false)
        }
        sync::SyncError::InvalidState => command_error(
            "invalid_state",
            "planning workspace is not applicable in its current state",
            false,
        ),
    }
}

async fn persist_apply(
    pool: &SqlitePool,
    original: &Workspace,
    applying: &Workspace,
    item_plans: &[(PlanningItem, Vec<SubtaskPlan>)],
    plan: &sync::OperationPlan,
    result: &sync::ApplyResult,
    idempotency_key: &str,
) -> Result<(), PlanningCommandError> {
    let final_status = match result.state {
        sync::PlanningState::Locked => "locked",
        sync::PlanningState::PartiallySynced => "partially_synced",
        sync::PlanningState::Conflict => "conflict",
        _ => "partially_synced",
    };
    let locked = final_status == "locked";
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| command_error("database", "planning database operation failed", true))?;
    sqlx::query("UPDATE planning_workspaces SET status = ?, revision = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'applying' AND revision = ?")
        .bind(final_status).bind(result.revision).bind(&original.id).bind(applying.revision).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;

    for (item, _) in item_plans {
        sqlx::query("UPDATE planning_items SET locked = ?, state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
            .bind(locked).bind(if locked { "locked" } else { "partially_synced" }).bind(&item.id).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;
    }
    for (index, (operation, operation_result)) in plan
        .batches
        .iter()
        .flat_map(|batch| batch.operations.iter())
        .zip(result.operation_results.iter())
        .enumerate()
    {
        let action_key = if index == 0 {
            idempotency_key.to_owned()
        } else {
            format!("{idempotency_key}:{}", operation_result.operation_id)
        };
        let status = match operation_result.status {
            sync::OperationResultStatus::Succeeded => SyncActionStatus::Succeeded,
            sync::OperationResultStatus::Failed => SyncActionStatus::Failed,
            sync::OperationResultStatus::Unknown => SyncActionStatus::Unknown,
        };
        let (remote_issue_id, remote_sprint_id, remote_subtask_id) =
            remote_ids(operation, operation_result.remote_reference.as_deref());
        sqlx::query("INSERT INTO planning_sync_actions (id,workspace_id,operation_type,idempotency_key,request_hash,status,remote_issue_id,remote_sprint_id,remote_subtask_id,retry_count,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(Uuid::now_v7().to_string()).bind(&original.id).bind(operation.operation_type()).bind(action_key).bind(&plan.request_hash).bind(status.as_str()).bind(remote_issue_id).bind(remote_sprint_id).bind(remote_subtask_id.clone()).bind(0_i64).bind(&operation_result.error).bind(timestamp()).bind(timestamp()).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;
        if operation_result.status == sync::OperationResultStatus::Succeeded {
            if let sync::PlannedOperation::CreateSubtask {
                parent_issue_id,
                competency_key,
                summary,
                ..
            }
            | sync::PlannedOperation::UpdateSubtask {
                parent_issue_id,
                competency_key,
                summary,
                ..
            } = operation
            {
                if let Some((item, subtasks)) = item_plans
                    .iter()
                    .find(|(item, _)| item.issue_id == *parent_issue_id)
                {
                    if let Some(subtask) = subtasks.iter().find(|subtask| {
                        subtask.remote_subtask_id.as_deref() == remote_subtask_id.as_deref()
                            || (subtask.competency_key == *competency_key
                                && subtask.summary == *summary)
                    }) {
                        sqlx::query("UPDATE planning_subtask_plans SET remote_subtask_id = COALESCE(?, remote_subtask_id), sync_status = 'succeeded', locked = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND planning_item_id = ?")
                            .bind(remote_subtask_id).bind(locked).bind(&subtask.id).bind(&item.id).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;
                    }
                }
            }
        }
    }
    if plan.batches.is_empty() {
        sqlx::query("INSERT INTO planning_sync_actions (id,workspace_id,operation_type,idempotency_key,request_hash,status,retry_count,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)")
            .bind(Uuid::now_v7().to_string()).bind(&original.id).bind("planning_apply").bind(idempotency_key).bind(&plan.request_hash).bind(if locked { "succeeded" } else { "unknown" }).bind(timestamp()).bind(timestamp()).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;
    }
    sqlx::query("INSERT INTO planning_audit_events (id,workspace_id,planning_item_id,action,previous_state,next_state,actor,remote_operation_id,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(Uuid::now_v7().to_string()).bind(&original.id).bind(Option::<String>::None).bind("apply_and_lock").bind("applying").bind(final_status).bind("local-user").bind(Option::<String>::None).bind(timestamp()).execute(&mut *transaction).await.map_err(|_| command_error("database", "planning database operation failed", true))?;
    transaction
        .commit()
        .await
        .map_err(|_| command_error("database", "planning database operation failed", true))
}

fn remote_ids(
    operation: &sync::PlannedOperation,
    reference: Option<&str>,
) -> (Option<String>, Option<String>, Option<String>) {
    match operation {
        sync::PlannedOperation::MoveIssue {
            issue_id,
            target_sprint_id,
            ..
        } => (Some(issue_id.clone()), Some(target_sprint_id.clone()), None),
        sync::PlannedOperation::UpdateParentAssignee { issue_id, .. }
        | sync::PlannedOperation::UpdateField { issue_id, .. } => {
            (Some(issue_id.clone()), None, None)
        }
        sync::PlannedOperation::CreateSubtask { .. }
        | sync::PlannedOperation::UpdateSubtask { .. } => {
            (None, None, reference.map(str::to_owned))
        }
    }
}

fn command_from_apply_result(result: &sync::ApplyResult) -> PlanningCommandError {
    let error = result
        .operation_results
        .iter()
        .find_map(|value| value.error.as_deref())
        .unwrap_or("Jira planning write did not complete");
    let retryable = result
        .operation_results
        .iter()
        .any(|value| value.status == sync::OperationResultStatus::Unknown);
    let code = if error == "remote_conflict" {
        "remote_conflict"
    } else if retryable {
        "jira_write_ambiguous"
    } else {
        error
    };
    command_error(
        code,
        "Jira planning write did not complete; the workspace was not locked",
        retryable,
    )
}
fn validate_draft(request: &PlanningDraftRequest) -> Result<(), PlanningCommandError> {
    if request.workspace_id.trim().is_empty() || request.parent_issue_id.trim().is_empty() {
        return Err(command_error(
            "invalid_input",
            "workspaceId and parentIssueId are required",
            false,
        ));
    }
    if request.subtasks.iter().any(|value| {
        value.summary.trim().is_empty()
            || value.competency.trim().is_empty()
            || value
                .story_points
                .is_some_and(|points| !(0..=100).contains(&points))
    }) {
        return Err(command_error(
            "invalid_input",
            "draft subtasks must have a summary, competency, and story points from 0 to 100",
            false,
        ));
    }
    Ok(())
}

pub(crate) async fn planning_read_client<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    project: &ManagedProject,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<(JiraPlanningClient, JiraDeployment), PlanningCommandError> {
    planning_read_client_for_integration(pool, &project.integration_id, keyring, transport).await
}

async fn planning_read_client_for_integration<S: CredentialStore + ?Sized>(
    pool: &SqlitePool,
    integration_id: &str,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<(JiraPlanningClient, JiraDeployment), PlanningCommandError> {
    let integration = repositories::get_integration(pool, integration_id)
        .await
        .map_err(|_| command_error("not_found", "Jira integration was not found", false))?;
    if !integration.enabled || integration.kind != crate::domain::models::IntegrationKind::Jira {
        return Err(command_error(
            "capability_unavailable",
            "Jira integration is disabled",
            false,
        ));
    }
    let deployment = deployment_from_capabilities(&integration.capabilities_json)?;
    let secret = keyring
        .load(&integration.credential_ref)
        .map_err(map_credential_error)?;
    if secret.is_empty() {
        return Err(command_error(
            "missing_credential",
            "Jira credential is missing",
            false,
        ));
    }
    JiraPlanningClient::new_with_dependencies(
        &integration.base_url,
        deployment,
        transport,
        Some(integration.account_key),
        Some(secret),
    )
    .map(|client| (client, deployment))
    .map_err(|_| {
        command_error(
            "transport_unavailable",
            "Jira read client is unavailable",
            true,
        )
    })
}

pub(crate) async fn list_planning_managed_projects_with_dependencies<
    S: CredentialStore + ?Sized,
>(
    pool: &SqlitePool,
    values: Vec<ManagedProject>,
    keyring: &S,
    transport: Arc<dyn JiraPlanningTransport>,
) -> Result<Vec<PlanningManagedProjectDto>, PlanningCommandError> {
    let mut result = Vec::with_capacity(values.len());
    for project in values {
        let mut dto = planning_project_dto(project.clone());
        let configured = project
            .board_id
            .as_deref()
            .is_some_and(|value| !value.is_empty());
        if !configured {
            result.push(dto);
            continue;
        }
        let (client, _) =
            match planning_read_client(pool, &project, keyring, transport.clone()).await {
                Ok(value) => value,
                Err(error)
                    if matches!(
                        error.code.as_str(),
                        "missing_credential" | "missing_metadata" | "unsupported_capability"
                    ) =>
                {
                    result.push(dto);
                    continue;
                }
                Err(error) => return Err(error),
            };
        let remote_projects = match client.list_projects(50).await {
            Ok(value) => value,
            Err(_) => {
                result.push(dto);
                continue;
            }
        };
        let remote_project = remote_projects.values.iter().find(|value| {
            value.id == project.jira_project_id || value.key == project.jira_project_key
        });
        let remote_boards = client
            .list_boards(50)
            .await
            .map_err(|error| map_read_error_at(error, "list_boards", "/rest/agile/1.0/board"))?;
        let remote_board = remote_boards
            .values
            .iter()
            .find(|value| value.id == project.board_id.clone().unwrap_or_default());
        if let Some(remote_project) = remote_project {
            dto.name = remote_project.name.clone();
        }
        if let Some(remote_board) = remote_board {
            dto.board_name = remote_board.name.clone();
        }
        dto.availability = if remote_project.is_some() && remote_board.is_some() {
            PlanningAvailability::Available
        } else {
            PlanningAvailability::Empty
        };
        result.push(dto);
    }
    Ok(result)
}

fn map_read_error_at(
    error: JiraError,
    operation: &'static str,
    endpoint: &'static str,
) -> PlanningCommandError {
    let status = match &error {
        JiraError::Http { status, .. } => Some(*status),
        _ => None,
    };
    let response_body = match &error {
        JiraError::Http {
            response_body: Some(body),
            ..
        } => crate::infrastructure::integrations::error_body::sanitize_error_body(
            body.to_string().as_bytes(),
        ),
        _ => None,
    };
    let mut mapped = map_read_error(error);
    let mut details = crate::application::integration_error::IntegrationErrorDetails::new(
        "jira", operation, "GET", endpoint, status,
    );
    details.response_body = response_body;
    mapped.details = Some(Box::new(details));
    mapped
}

fn map_read_error(error: JiraError) -> PlanningCommandError {
    match error {
        JiraError::UnsupportedCapability => command_error(
            "unsupported_capability",
            "Jira planning read capability is unavailable",
            false,
        ),
        JiraError::Http { status: 401, .. } => command_error(
            "authentication_required",
            "Jira authentication is required (HTTP 401)",
            false,
        ),
        JiraError::Http { status: 403, .. } => command_error(
            "permission_denied",
            "Jira planning read permission denied (HTTP 403)",
            false,
        ),
        JiraError::Http { status: 404, .. } => command_error(
            "not_found",
            "Jira planning object was not found (HTTP 404)",
            false,
        ),
        JiraError::Http { status: 429, .. } => {
            command_error("rate_limited", "Jira rate limit exceeded (HTTP 429)", true)
        }
        JiraError::Http {
            status,
            retryable: true,
            ..
        } => command_error(
            "transport_unavailable",
            &format!("Jira read request failed (HTTP {status})"),
            true,
        ),
        JiraError::Http { status, .. } => command_error(
            "remote_error",
            &format!("Jira planning read request failed (HTTP {status})"),
            false,
        ),
        JiraError::Transport => command_error(
            "transport_unavailable",
            "Jira read transport is unavailable",
            true,
        ),
        JiraError::InvalidBaseUrl => {
            command_error("invalid_metadata", "Jira base URL is invalid", false)
        }
        JiraError::InvalidResponseDetails(_) => command_error(
            "invalid_response",
            "Jira returned an invalid response",
            false,
        ),
        JiraError::InvalidResponse => command_error(
            "invalid_response",
            "Jira returned an invalid response",
            false,
        ),
    }
}

async fn build_remote_workspace(
    pool: &SqlitePool,
    project: ManagedProject,
    workspace: Workspace,
    source_sprint: PlanningSprint,
    target_sprint: PlanningSprint,
    source_issues: Vec<PlanningIssue>,
    target_issues: Vec<PlanningIssue>,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    let mut dto = build_workspace(pool, project.clone(), workspace).await?;
    dto.source_sprint =
        remote_sprint_dto(&source_sprint, project.board_id.clone().unwrap_or_default());
    dto.target_sprint =
        remote_sprint_dto(&target_sprint, project.board_id.clone().unwrap_or_default());
    dto.source_issues = source_issues
        .iter()
        .map(|issue| remote_issue_dto(issue, Some(&source_sprint.id), None, &project))
        .collect();
    dto.target_issues = target_issues
        .iter()
        .map(|issue| remote_issue_dto(issue, None, Some(&target_sprint.id), &project))
        .collect();
    dto.read_state = if dto.source_issues.is_empty() && dto.target_issues.is_empty() {
        PlanningAvailability::Empty
    } else {
        PlanningAvailability::Available
    };
    dto.read_state_reason = None;
    Ok(dto)
}

fn remote_sprint_dto(value: &PlanningSprint, board_id: String) -> PlanningSprintDto {
    PlanningSprintDto {
        id: value.id.clone(),
        board_id,
        name: value.name.clone(),
        state: value.state.clone(),
        usable: matches!(value.state.as_str(), "OPEN" | "ACTIVE"),
        start_date: value.start_date.clone(),
        end_date: value.end_date.clone(),
        availability: PlanningAvailability::Available,
    }
}

fn remote_issue_dto(
    issue: &PlanningIssue,
    source_sprint_id: Option<&str>,
    target_sprint_id: Option<&str>,
    project: &ManagedProject,
) -> PlanningIssueDto {
    let fields = &issue.fields;
    let subtasks = fields
        .get("subtasks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| remote_subtask_dto(value, project))
        .collect();
    PlanningIssueDto {
        id: issue.id.clone(),
        key: issue.key.clone(),
        summary: field_string(fields, "summary").unwrap_or_default(),
        status: fields
            .pointer("/status/name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .into(),
        story_points: project
            .story_points_field_id
            .as_deref()
            .and_then(|id| field_i64(fields, id)),
        assignee: remote_assignee(fields),
        source_sprint_id: source_sprint_id.map(str::to_owned),
        target_sprint_id: target_sprint_id.map(str::to_owned),
        sync_state: "remote".into(),
        subtasks,
    }
}

fn remote_subtask_dto(value: &Value, project: &ManagedProject) -> Option<PlanningSubtaskDto> {
    let id = value.get("id").and_then(Value::as_str)?.to_owned();
    let fields = value.get("fields")?;
    Some(PlanningSubtaskDto {
        id,
        summary: field_string(fields, "summary").unwrap_or_default(),
        competency: project
            .competency_field_id
            .as_deref()
            .and_then(|id| field_string(fields, id)),
        story_points: project
            .story_points_field_id
            .as_deref()
            .and_then(|id| field_i64(fields, id)),
        assignee: remote_assignee(fields),
        sync_state: "remote".into(),
        is_remote: true,
        required: None,
        local_revision: None,
    })
}

fn remote_assignee(fields: &Value) -> Option<PlanningAssigneeDto> {
    let assignee = fields.get("assignee")?;
    let account_id = assignee
        .get("accountId")
        .and_then(Value::as_str)?
        .to_owned();
    Some(PlanningAssigneeDto {
        account_id,
        display_name: assignee
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .into(),
        avatar_url: assignee
            .pointer("/avatarUrls/48x48")
            .and_then(Value::as_str)
            .map(str::to_owned),
        active: assignee.get("active").and_then(Value::as_bool),
    })
}

fn field_string(fields: &Value, field_id: &str) -> Option<String> {
    fields.get(field_id).and_then(|value| {
        value.as_str().map(str::to_owned).or_else(|| {
            value
                .get("value")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
    })
}

fn field_i64(fields: &Value, field_id: &str) -> Option<i64> {
    fields
        .get(field_id)
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
}

async fn build_workspace(
    pool: &SqlitePool,
    project: ManagedProject,
    workspace: Workspace,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    let items = planning_repositories::list_planning_items(pool, &workspace.id)
        .await
        .map_err(db_error)?;
    let mut drafts = Vec::new();
    let mut target_issues = Vec::new();
    for item in items {
        let plans = planning_repositories::list_subtask_plans(pool, &item.id)
            .await
            .map_err(db_error)?;
        let subtasks = plans.iter().map(subtask_dto).collect::<Vec<_>>();
        let draft_subtasks = plans
            .iter()
            .map(|value| PlanningDraftSubtaskRequest {
                id: value.id.clone(),
                summary: value.summary.clone(),
                competency: value.competency_key.clone(),
                story_points: value.story_points,
                assignee_account_id: value.assignee_account_id.clone(),
                required: true,
            })
            .collect::<Vec<_>>();
        drafts.push(PlanningDraftDto {
            id: item.id.clone(),
            workspace_id: workspace.id.clone(),
            parent_issue_id: item.issue_id.clone(),
            subtasks: draft_subtasks,
            revision: plans
                .first()
                .map(|value| value.local_revision)
                .unwrap_or(workspace.revision),
        });
        target_issues.push(PlanningIssueDto {
            id: item.issue_id,
            key: item.issue_key,
            summary: "Jira issue details unavailable; showing local planning state".into(),
            status: item.state,
            story_points: None,
            assignee: None,
            source_sprint_id: item.source_sprint_id,
            target_sprint_id: item.target_sprint_id,
            sync_state: "local".into(),
            subtasks,
        });
    }
    let managed_project = planning_project_dto(project.clone());
    Ok(PlanningWorkspaceDto {
        id: workspace.id,
        managed_project,
        source_sprint: unavailable_sprint(
            workspace.source_sprint_id.clone().unwrap_or_default(),
            project.board_id.clone().unwrap_or_default(),
            project
                .source_sprint_name
                .unwrap_or_else(|| "Unavailable".into()),
        ),
        target_sprint: unavailable_sprint(
            workspace.target_sprint_id.clone(),
            project.board_id.unwrap_or_default(),
            "Unavailable".into(),
        ),
        source_issues: Vec::new(),
        target_issues,
        drafts,
        revision: workspace.revision.to_string(),
        status: workspace.status,
        loaded_at: workspace.updated_at,
        read_state: PlanningAvailability::Unavailable,
        read_state_reason: Some(
            "Jira planning read unavailable; showing local planning state".into(),
        ),
    })
}

fn unavailable_sprint(id: String, board_id: String, name: String) -> PlanningSprintDto {
    PlanningSprintDto {
        id,
        board_id,
        name,
        state: "unknown".into(),
        usable: false,
        start_date: None,
        end_date: None,
        availability: PlanningAvailability::Unavailable,
    }
}
fn subtask_dto(value: &SubtaskPlan) -> PlanningSubtaskDto {
    PlanningSubtaskDto {
        id: value.id.clone(),
        summary: value.summary.clone(),
        competency: Some(value.competency_key.clone()),
        story_points: value.story_points,
        assignee: value
            .assignee_account_id
            .clone()
            .map(|account_id| PlanningAssigneeDto {
                display_name: account_id.clone(),
                account_id,
                avatar_url: None,
                active: None,
            }),
        sync_state: "local".into(),
        is_remote: value.remote_subtask_id.is_some(),
        required: Some(true),
        local_revision: Some(value.local_revision),
    }
}
fn team_member_dto(value: TeamMember) -> TeamMemberDto {
    TeamMemberDto {
        account_id: value.account_id,
        display_name: value.display_name,
        alias: value.alias,
        avatar_url: value.avatar_url,
        active: value.active,
        tags: serde_json::from_str(&value.tags_json).unwrap_or_default(),
        display_order: value.display_order,
    }
}

fn team_preset_dto(
    managed_project_id: &str,
    value: TeamPreset,
    members: Vec<TeamMember>,
) -> TeamPresetDto {
    let mut tags = std::collections::HashMap::new();
    for member in &members {
        let parsed: Vec<String> = serde_json::from_str(&member.tags_json).unwrap_or_default();
        if !parsed.is_empty() {
            tags.insert(member.account_id.clone(), parsed);
        }
    }
    TeamPresetDto {
        id: value.id,
        managed_project_id: managed_project_id.into(),
        name: value.name,
        color: value.display_color,
        member_account_ids: members
            .iter()
            .map(|member| member.account_id.clone())
            .collect(),
        member_tags: (!tags.is_empty()).then_some(tags),
        selected: Some(value.selected),
    }
}
fn planning_project_dto(value: ManagedProject) -> PlanningManagedProjectDto {
    PlanningManagedProjectDto {
        id: value.id,
        integration_id: value.integration_id,
        jira_project_id: value.jira_project_id,
        name: value.jira_project_name,
        board_id: value.board_id.clone().unwrap_or_default(),
        board_name: "Unavailable".into(),
        source_sprint_id: value.source_sprint_id,
        source_sprint_name: value.source_sprint_name,
        story_points_field_id: value.story_points_field_id,
        default_task_sprint_id: value.default_task_sprint_id,
        default_task_sprint_name: value.default_task_sprint_name,
        default_epic_link_key: value.default_epic_link_key,
        default_epic_link_summary: value.default_epic_link_summary,
        epic_link_jql: value.epic_link_jql,
        availability: PlanningAvailability::Unavailable,
    }
}
pub fn managed_project_dto(
    value: ManagedProject,
    confluence_space: Option<ManagedProjectConfluenceSpace>,
) -> Result<ManagedProjectDto, PlanningError> {
    Ok(ManagedProjectDto {
        id: value.id,
        integration_id: value.integration_id,
        project_id: value.jira_project_id,
        project_key: value.jira_project_key,
        project_name: value.jira_project_name,
        confluence_space: confluence_space.map(|space| ConfluenceSpaceDto {
            integration_id: space.integration_id,
            space_id: space.space_id,
            space_key: space.space_key,
            space_name: space.space_name,
        }),
        board_id: value.board_id,
        source_sprint_id: value.source_sprint_id,
        source_sprint_name: value.source_sprint_name,
        story_points_field_id: value.story_points_field_id,
        competency_field_id: value.competency_field_id,
        subtask_issue_type_id: value.subtask_issue_type_id,
        default_team_preset_id: value.default_team_preset_id,
        default_task_sprint_id: value.default_task_sprint_id,
        default_task_sprint_name: value.default_task_sprint_name,
        default_epic_link_key: value.default_epic_link_key,
        default_epic_link_summary: value.default_epic_link_summary,
        epic_link_jql: value.epic_link_jql,
        enabled: value.enabled,
        last_metadata_refresh_at: value.last_metadata_refresh_at,
        created_at: value.created_at,
        updated_at: value.updated_at,
    })
}
fn workspace_record_dto(value: Workspace) -> Result<PlanningWorkspaceRecordDto, PlanningError> {
    Ok(PlanningWorkspaceRecordDto {
        id: value.id,
        managed_project_id: value.managed_project_id,
        source_sprint_id: value.source_sprint_id,
        target_sprint_id: value.target_sprint_id,
        revision: value.revision,
        status: value.status,
        remote_revision: value.remote_revision,
        created_at: value.created_at,
        updated_at: value.updated_at,
    })
}
fn capabilities_dto(value: PlanningCapabilities) -> PlanningCapabilitiesDto {
    PlanningCapabilitiesDto {
        projects: value.projects,
        boards: value.boards,
        sprints: value.sprints,
        sprint_issues: value.sprint_issues,
        assignable_users: value.assignable_users,
        fields: value.fields,
        create_metadata: value.create_metadata.into(),
        move_issues_max: value.move_issues_max,
        reason: value.reason,
    }
}
fn db_error(_: sqlx::Error) -> PlanningCommandError {
    command_error("database", "planning database operation failed", true)
}
fn command_error(code: &str, message: &str, retryable: bool) -> PlanningCommandError {
    PlanningCommandError {
        code: code.into(),
        message: message.into(),
        retryable,
        details: None,
    }
}
fn default_enabled() -> bool {
    true
}
fn timestamp() -> String {
    format!(
        "local:{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default()
    )
}

#[cfg(test)]
mod integration_error_tests {
    use super::*;

    #[test]
    fn jira_http_error_dto_contains_operation_and_status() {
        let error = map_read_error_at(
            JiraError::Http {
                status: 403,
                retryable: false,
                retry_after_seconds: None,
                response_body: Some(
                    serde_json::json!({"errorMessages": ["You are not permitted"], "password": "hidden"}),
                ),
            },
            "list_usable_sprints",
            "/rest/agile/1.0/board/{board}/sprint",
        );
        let dto = serde_json::to_value(error).unwrap();
        assert_eq!(dto["code"], "permission_denied");
        assert_eq!(dto["details"]["provider"], "jira");
        assert_eq!(dto["details"]["method"], "GET");
        assert_eq!(dto["details"]["httpStatus"], 403);
        assert_eq!(dto["details"]["operation"], "list_usable_sprints");
        assert_eq!(
            dto["details"]["responseBody"]["errorMessages"][0],
            "You are not permitted"
        );
        assert!(!dto.to_string().contains("hidden"));
        assert_eq!(
            dto["details"]["endpoint"],
            "/rest/agile/1.0/board/{board}/sprint"
        );
    }
}
