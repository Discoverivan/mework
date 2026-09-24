use sqlx::SqlitePool;
use tauri::State;

use crate::application::dev_overlay::DevMockMode;
use crate::application::planning::{
    self, ApplyAndLockRequest, EpicLinkJqlIssueDto, EpicLinkJqlPreviewRequest, JiraBoardDto,
    JiraProjectBoardsRequest, JiraProjectValidationDto, JiraProjectValidationRequest,
    ManagedProjectDto, ManagedProjectRequest, PlanningCapabilitiesDto, PlanningCommandError,
    PlanningDraftDto, PlanningDraftRequest, PlanningManagedProjectDto, PlanningSprintDto,
    PlanningSprintRequest, PlanningWorkspaceDto, PlanningWorkspaceRecordDto, TeamMemberAddRequest,
    TeamMemberDto, TeamMemberReorderRequest, TeamMemberSearchRequest, TeamPresetDto,
    TeamPresetInput,
};
use crate::infrastructure::integrations::jira::models::JiraDeployment;

fn mock_mode_error() -> PlanningCommandError {
    PlanningCommandError {
        code: "mock_mode".to_owned(),
        message: "Mock data is unavailable for this request".to_owned(),
        retryable: false,
        details: None,
    }
}

pub const PLANNING_COMMAND_NAMES: &[&str] = &[
    "planning_managed_projects",
    "planning_project_validate",
    "planning_project_boards",
    "planning_target_sprints",
    "planning_epic_link_jql_preview",
    "planning_workspace",
    "planning_draft_save",
    "planning_draft_remove",
    "planning_team_presets",
    "planning_team_preset_save",
    "planning_team_preset_remove",
    "planning_team_members",
    "planning_team_members_configured",
    "planning_team_members_search",
    "planning_team_member_add",
    "planning_team_member_remove",
    "planning_team_member_reorder",
    "planning_apply_and_lock",
];

#[tauri::command]
pub async fn managed_project_list(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    integration_id: Option<String>,
) -> Result<Vec<ManagedProjectDto>, String> {
    if mode.is_enabled() {
        return mode.mock_managed_projects().map(|projects| {
            projects
                .into_iter()
                .filter(|project| {
                    integration_id
                        .as_deref()
                        .is_none_or(|id| project.integration_id == id)
                })
                .collect()
        });
    }
    planning::list_managed_projects(&state, integration_id.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn managed_project_save(
    state: State<'_, SqlitePool>,
    request: ManagedProjectRequest,
) -> Result<ManagedProjectDto, String> {
    planning::save_managed_project(&state, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn managed_project_delete(
    state: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    planning::delete_managed_project(&state, &id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn planning_metadata_capabilities(deployment: JiraDeployment) -> PlanningCapabilitiesDto {
    planning::planning_capabilities(deployment)
}

#[tauri::command]
pub async fn planning_workspace_list(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<PlanningWorkspaceRecordDto>, String> {
    planning::list_workspaces(&state, &managed_project_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn planning_managed_projects(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<Vec<PlanningManagedProjectDto>, PlanningCommandError> {
    if mode.is_enabled() {
        return mode.mock_planning_projects().map_err(|_| mock_mode_error());
    }
    planning::list_planning_managed_projects(&state).await
}

#[tauri::command]
pub async fn planning_project_validate(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: JiraProjectValidationRequest,
) -> Result<JiraProjectValidationDto, PlanningCommandError> {
    if mode.is_enabled() {
        if request.integration_id != "mock-jira" || request.project_key.trim().is_empty() {
            return Err(mock_mode_error());
        }
        return Ok(JiraProjectValidationDto {
            project_id: "mock-project-id".to_owned(),
            project_key: request.project_key,
            project_name: "MOCK DATA — Example project".to_owned(),
        });
    }
    planning::validate_project_key(&state, request).await
}
#[tauri::command]
pub async fn planning_project_boards(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: JiraProjectBoardsRequest,
) -> Result<Vec<JiraBoardDto>, PlanningCommandError> {
    if mode.is_enabled() {
        if request.integration_id != "mock-jira" || request.project_key.trim().is_empty() {
            return Err(mock_mode_error());
        }
        return Ok(vec![JiraBoardDto {
            id: "mock-board-1".to_owned(),
            name: "MOCK DATA — Example board".to_owned(),
            board_type: Some("scrum".to_owned()),
        }]);
    }
    planning::list_project_boards(&state, request).await
}

#[tauri::command]
pub async fn planning_target_sprints(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<PlanningSprintDto>, PlanningCommandError> {
    if mode.is_enabled() {
        return mode
            .mock_target_sprints(&managed_project_id)
            .map_err(|_| mock_mode_error());
    }
    planning::list_target_sprints(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn planning_epic_link_jql_preview(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: EpicLinkJqlPreviewRequest,
) -> Result<Vec<EpicLinkJqlIssueDto>, PlanningCommandError> {
    if mode.is_enabled() {
        if request.managed_project_id != "mock-managed-project" {
            return Err(mock_mode_error());
        }
        return Ok(vec![
            EpicLinkJqlIssueDto {
                key: "MOCK-301".to_owned(),
                summary: "MOCK DATA — Example epic: improve onboarding".to_owned(),
            },
            EpicLinkJqlIssueDto {
                key: "MOCK-302".to_owned(),
                summary: "MOCK DATA — Example epic: streamline workflow".to_owned(),
            },
        ]);
    }
    planning::preview_epic_link_jql(&state, request).await
}

#[tauri::command]
pub async fn planning_workspace(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PlanningSprintRequest,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    mode.require_live_provider_access()
        .map_err(|_| mock_mode_error())?;
    planning::load_planning_workspace(&state, request).await
}

#[tauri::command]
pub async fn planning_draft_save(
    state: State<'_, SqlitePool>,
    request: PlanningDraftRequest,
) -> Result<PlanningDraftDto, PlanningCommandError> {
    planning::save_planning_draft(&state, request).await
}

#[tauri::command]
pub async fn planning_draft_remove(
    state: State<'_, SqlitePool>,
    draft_id: String,
) -> Result<(), PlanningCommandError> {
    planning::remove_planning_draft(&state, &draft_id).await
}

#[tauri::command]
pub async fn planning_team_presets(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<TeamPresetDto>, PlanningCommandError> {
    planning::list_team_presets(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn planning_team_preset_save(
    state: State<'_, SqlitePool>,
    request: TeamPresetInput,
) -> Result<TeamPresetDto, PlanningCommandError> {
    planning::save_team_preset(&state, request).await
}

#[tauri::command]
pub async fn planning_team_preset_remove(
    state: State<'_, SqlitePool>,
    preset_id: String,
) -> Result<(), PlanningCommandError> {
    planning::remove_team_preset(&state, &preset_id).await
}

#[tauri::command]
pub async fn planning_team_members(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    if mode.is_enabled() {
        if managed_project_id != "mock-managed-project" {
            return Err(mock_mode_error());
        }
        return mode.mock_team_members().map_err(|_| mock_mode_error());
    }
    planning::list_team_members(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn planning_team_members_configured(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    if mode.is_enabled() {
        if managed_project_id != "mock-managed-project" {
            return Err(mock_mode_error());
        }
        return mode.mock_team_members().map_err(|_| mock_mode_error());
    }
    planning::list_configured_team_members(&state, &managed_project_id).await
}

#[tauri::command]
pub async fn jira_avatar_data(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    avatar_url: String,
) -> Result<Option<String>, PlanningCommandError> {
    if mode.is_enabled() {
        let _ = (managed_project_id, avatar_url);
        return Ok(None);
    }
    planning::load_jira_avatar_data(&state, &managed_project_id, &avatar_url).await
}

#[tauri::command]
pub async fn planning_team_members_search(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: TeamMemberSearchRequest,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    if mode.is_enabled() {
        if request.managed_project_id != "mock-managed-project" {
            return Err(mock_mode_error());
        }
        let query = request.query.trim().to_lowercase();
        return mode
            .mock_team_members()
            .map(|members| {
                members
                    .into_iter()
                    .filter(|member| {
                        query.is_empty()
                            || member.display_name.to_lowercase().contains(&query)
                            || member.account_id.to_lowercase().contains(&query)
                    })
                    .collect()
            })
            .map_err(|_| mock_mode_error());
    }
    planning::search_team_members(&state, request).await
}

#[tauri::command]
pub async fn planning_team_member_add(
    state: State<'_, SqlitePool>,
    request: TeamMemberAddRequest,
) -> Result<TeamMemberDto, PlanningCommandError> {
    planning::add_team_member(&state, request).await
}

#[tauri::command]
pub async fn planning_team_member_remove(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    account_id: String,
) -> Result<(), PlanningCommandError> {
    planning::remove_team_member(&state, &managed_project_id, &account_id).await
}

#[tauri::command]
pub async fn planning_team_member_reorder(
    state: State<'_, SqlitePool>,
    request: TeamMemberReorderRequest,
) -> Result<Vec<TeamMemberDto>, PlanningCommandError> {
    planning::reorder_team_members(&state, request).await
}

#[tauri::command]
pub async fn planning_apply_and_lock(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: ApplyAndLockRequest,
) -> Result<PlanningWorkspaceDto, PlanningCommandError> {
    mode.require_live_provider_access()
        .map_err(|_| mock_mode_error())?;
    planning::apply_and_lock(&state, request).await
}
