use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::daily::{DailyMyTasksDto, DailySprintStatsDto, DailyTeamWorkspaceDto};
use crate::application::planning::PlanningCommandError;

#[tauri::command]
pub async fn daily_my_tasks(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: Option<String>,
) -> Result<DailyMyTasksDto, PlanningCommandError> {
    crate::application::daily::load_daily_my_tasks(
        &state,
        &managed_project_id,
        sprint_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn daily_team_workspace(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: Option<String>,
) -> Result<DailyTeamWorkspaceDto, PlanningCommandError> {
    crate::application::daily::load_daily_team_workspace(
        &state,
        &managed_project_id,
        sprint_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn daily_sprint_stats(
    app: AppHandle,
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
    request_id: String,
) -> Result<DailySprintStatsDto, PlanningCommandError> {
    crate::application::daily::load_daily_sprint_stats(
        &state,
        &managed_project_id,
        &sprint_id,
        &request_id,
        &app,
    )
    .await
}

#[tauri::command]
pub async fn daily_workspace_refresh(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
) -> Result<Vec<crate::application::daily::DailySubtaskDto>, PlanningCommandError> {
    crate::application::daily::refresh_daily_workspace(&state, &managed_project_id, &sprint_id)
        .await
}

#[tauri::command]
pub async fn daily_issue_transitions(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
    issue_key: String,
) -> Result<
    Vec<crate::infrastructure::data_integrations::jira::planning::JiraIssueTransition>,
    PlanningCommandError,
> {
    crate::application::daily::daily_issue_transitions(
        &state,
        &managed_project_id,
        &sprint_id,
        &issue_key,
    )
    .await
}

#[tauri::command]
pub async fn daily_issue_transition(
    state: State<'_, SqlitePool>,
    managed_project_id: String,
    sprint_id: String,
    issue_key: String,
    transition_id: String,
    idempotency_key: String,
) -> Result<(), PlanningCommandError> {
    crate::application::daily::transition_daily_issue(
        &state,
        &managed_project_id,
        &sprint_id,
        &issue_key,
        &transition_id,
        &idempotency_key,
    )
    .await
}
