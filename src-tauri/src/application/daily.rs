use std::sync::Arc;
use std::time::Duration;

use reqwest::{Client, Url};
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::application::planning::{self, PlanningCommandError, TeamMemberDto};
use crate::infrastructure::db::planning_repositories;
use crate::infrastructure::integrations::jira::planning_write::ReqwestPlanningTransport;

const DEFAULT_STORY_POINTS_FIELD_ID: &str = "customfield_10372";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailySubtaskDto {
    pub id: String,
    pub key: String,
    pub summary: String,
    pub status: String,
    pub story_points: Option<i64>,
    pub status_transition_at: Option<String>,
    pub assignee_account_id: Option<String>,
    pub assignee_display_name: Option<String>,
    pub issue_type: String,
    pub parent_issue_key: Option<String>,
    pub url: String,
    pub parent_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailySprintDto {
    pub id: String,
    pub name: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyWorkspaceDto {
    pub managed_project_id: String,
    pub project_name: String,
    pub project_key: String,
    pub selected_sprint_id: String,
    pub selected_sprint_name: String,
    pub sprints: Vec<DailySprintDto>,
    pub members: Vec<TeamMemberDto>,
    pub subtasks: Vec<DailySubtaskDto>,
}

pub async fn load_daily_workspace(
    pool: &SqlitePool,
    managed_project_id: &str,
    sprint_id: Option<&str>,
) -> Result<DailyWorkspaceDto, PlanningCommandError> {
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| daily_error("not_found", "managed project was not found", false))?;
    ensure_daily_dependencies(pool, &project.integration_id).await?;
    let board_id = project
        .board_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| daily_error("missing_metadata", "Jira board metadata is required", false))?;
    let members = planning::list_configured_team_members(pool, managed_project_id).await?;
    let keyring = planning::planning_credential_store(pool).await?;
    let mut builder = Client::builder().timeout(Duration::from_secs(30));
    let integration =
        crate::infrastructure::db::repositories::get_integration(pool, &project.integration_id)
            .await
            .map_err(|_| daily_error("not_found", "Jira integration was not found", false))?;
    if integration.allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let http = builder.build().map_err(|_| {
        daily_error(
            "transport_unavailable",
            "Jira transport is unavailable",
            true,
        )
    })?;
    let (client, _) = planning::planning_read_client(
        pool,
        &project,
        keyring.as_ref(),
        Arc::new(ReqwestPlanningTransport::new(http)),
    )
    .await?;
    let mut sprint_page = client
        .list_sprints(board_id, 100)
        .await
        .map_err(|_| daily_error("remote_error", "Unable to load Jira sprints", true))?;
    let active_sprint_page = client
        .list_active_sprints(board_id, 100)
        .await
        .map_err(|_| {
            daily_error(
                "remote_error",
                "Unable to load the active Jira sprint",
                true,
            )
        })?;
    let active_sprint_id = active_sprint_page
        .values
        .first()
        .map(|sprint| sprint.id.clone());
    for active_sprint in active_sprint_page.values {
        if !sprint_page
            .values
            .iter()
            .any(|sprint| sprint.id == active_sprint.id)
        {
            sprint_page.values.push(active_sprint);
        }
    }
    let selected_sprint =
        if let Some(requested_id) = sprint_id.filter(|value| !value.trim().is_empty()) {
            sprint_page
                .values
                .iter()
                .find(|sprint| sprint.id == requested_id)
                .ok_or_else(|| {
                    daily_error(
                        "not_found",
                        "The selected sprint was not found on the configured Jira board",
                        false,
                    )
                })?
        } else {
            active_sprint_id
                .as_deref()
                .and_then(|active_id| {
                    sprint_page
                        .values
                        .iter()
                        .find(|sprint| sprint.id == active_id)
                })
                .ok_or_else(|| {
                    daily_error(
                        "not_found",
                        "An active sprint was not found on the configured Jira board",
                        false,
                    )
                })?
        };
    let issues = client
        .list_sprint_issues_with_fields(
            &selected_sprint.id,
            100,
            project
                .story_points_field_id
                .as_deref()
                .or(Some(DEFAULT_STORY_POINTS_FIELD_ID)),
        )
        .await
        .map_err(|_| {
            daily_error(
                "remote_error",
                "Unable to load selected sprint issues",
                true,
            )
        })?;
    let subtasks = issues
        .values
        .into_iter()
        .map(|issue| {
            daily_task(
                issue.id,
                issue.key,
                issue.fields,
                project
                    .story_points_field_id
                    .as_deref()
                    .or(Some(DEFAULT_STORY_POINTS_FIELD_ID)),
                &integration.base_url,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut sprints = sprint_page
        .values
        .iter()
        .map(|sprint| DailySprintDto {
            id: sprint.id.clone(),
            name: sprint.name.clone(),
            state: sprint.state.to_ascii_lowercase(),
        })
        .collect::<Vec<_>>();
    sprints.sort_by_key(|sprint| match sprint.state.as_str() {
        "active" => 0,
        "future" => 1,
        _ => 2,
    });

    Ok(DailyWorkspaceDto {
        managed_project_id: project.id,
        project_name: project.jira_project_name,
        project_key: project.jira_project_key,
        selected_sprint_id: selected_sprint.id.clone(),
        selected_sprint_name: selected_sprint.name.clone(),
        sprints,
        members,
        subtasks,
    })
}

pub async fn refresh_daily_workspace(
    pool: &SqlitePool,
    managed_project_id: &str,
    sprint_id: &str,
) -> Result<Vec<DailySubtaskDto>, PlanningCommandError> {
    if sprint_id.trim().is_empty() {
        return Err(daily_error("invalid_input", "A sprint is required", false));
    }
    load_daily_workspace(pool, managed_project_id, Some(sprint_id))
        .await
        .map(|workspace| workspace.subtasks)
}

async fn ensure_daily_dependencies(
    pool: &SqlitePool,
    integration_id: &str,
) -> Result<(), PlanningCommandError> {
    let integration =
        crate::infrastructure::db::repositories::get_integration(pool, integration_id)
            .await
            .map_err(|_| daily_error("not_found", "Jira integration was not found", false))?;
    if integration.kind != crate::domain::models::IntegrationKind::Jira
        || !integration.enabled
        || integration.health_status != crate::domain::models::IntegrationHealthStatus::Working
    {
        return Err(daily_error(
            "integration_unavailable",
            "A working Jira integration is required for Sprint tasks",
            false,
        ));
    }
    Ok(())
}

fn daily_task(
    id: String,
    key: String,
    fields: Value,
    story_points_field_id: Option<&str>,
    jira_base_url: &str,
) -> Result<DailySubtaskDto, PlanningCommandError> {
    let issue_type = fields
        .get("issuetype")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Task")
        .to_owned();
    let assignee = fields.get("assignee").filter(|value| !value.is_null());
    let assignee_account_id =
        assignee.and_then(|value| first_string(value, &["accountId", "name", "key"]));
    let assignee_display_name = assignee
        .and_then(|value| value.get("displayName"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned);
    let summary = fields
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("Untitled task")
        .to_owned();
    let status = fields
        .get("status")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown status")
        .to_owned();
    let status_transition_at = fields
        .get("statuscategorychangedate")
        .or_else(|| fields.get("updated"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let parent_issue_key = fields
        .get("parent")
        .and_then(|value| value.get("key"))
        .and_then(Value::as_str)
        .map(str::to_owned);

    let url = jira_issue_url(jira_base_url, &key)?;
    let parent_url = parent_issue_key
        .as_deref()
        .map(|parent_key| jira_issue_url(jira_base_url, parent_key))
        .transpose()?;

    Ok(DailySubtaskDto {
        id,
        key,
        summary,
        status,
        story_points: story_points_field_id.and_then(|field_id| field_i64(&fields, field_id)),
        status_transition_at,
        assignee_account_id,
        assignee_display_name,
        issue_type,
        parent_issue_key,
        url,
        parent_url,
    })
}

fn jira_issue_url(base_url: &str, issue_key: &str) -> Result<String, PlanningCommandError> {
    let mut url = Url::parse(base_url)
        .map_err(|_| daily_error("invalid_configuration", "Jira base URL is invalid", false))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || issue_key.trim().is_empty()
    {
        return Err(daily_error(
            "invalid_configuration",
            "Jira issue URL could not be created",
            false,
        ));
    }
    url.set_query(None);
    url.set_fragment(None);
    {
        let mut segments = url.path_segments_mut().map_err(|_| {
            daily_error(
                "invalid_configuration",
                "Jira issue URL could not be created",
                false,
            )
        })?;
        segments.pop_if_empty();
        segments.push("browse");
        segments.push(issue_key);
    }
    Ok(url.to_string())
}

fn field_i64(fields: &Value, field_id: &str) -> Option<i64> {
    fields.get(field_id).and_then(|value| {
        value
            .as_i64()
            .or_else(|| value.as_f64().map(|points| points.round() as i64))
            .or_else(|| {
                value
                    .as_str()?
                    .parse::<f64>()
                    .ok()
                    .map(|points| points.round() as i64)
            })
    })
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
}

fn daily_error(code: &str, message: &str, retryable: bool) -> PlanningCommandError {
    PlanningCommandError {
        code: code.to_owned(),
        message: message.to_owned(),
        retryable,
    }
}

#[cfg(test)]
mod tests {
    use super::daily_task;
    use serde_json::json;

    #[test]
    fn maps_a_jira_issue_for_sprint_tasks() {
        let task = daily_task(
            "10002".into(),
            "DEMO-2".into(),
            json!({
                "summary": "Implement API",
                "status": {"name": "In Progress"},
                "statuscategorychangedate": "2026-09-14T16:32:10.000+0300",
                "issuetype": {"name": "Sub-task", "subtask": true},
                "assignee": {"accountId": "test-user-a", "displayName": "Test Member A"},
                "parent": {"key": "DEMO-1"},
                "customfield_10016": 5.0
            }),
            Some("customfield_10016"),
            "https://jira.example.invalid/work",
        )
        .unwrap();

        assert_eq!(task.key, "DEMO-2");
        assert_eq!(task.status, "In Progress");
        assert_eq!(task.assignee_account_id.as_deref(), Some("test-user-a"));
        assert_eq!(task.assignee_display_name.as_deref(), Some("Test Member A"));
        assert_eq!(task.issue_type, "Sub-task");
        assert_eq!(task.story_points, Some(5));
        assert_eq!(task.url, "https://jira.example.invalid/work/browse/DEMO-2");
        assert_eq!(
            task.parent_url.as_deref(),
            Some("https://jira.example.invalid/work/browse/DEMO-1")
        );
        assert_eq!(
            task.status_transition_at.as_deref(),
            Some("2026-09-14T16:32:10.000+0300")
        );
    }
}
