use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
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
    pub assignee_account_id: String,
    pub parent_issue_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DailyWorkspaceDto {
    pub managed_project_id: String,
    pub project_name: String,
    pub project_key: String,
    pub active_sprint_id: String,
    pub active_sprint_name: String,
    pub members: Vec<TeamMemberDto>,
    pub subtasks: Vec<DailySubtaskDto>,
}

pub async fn load_daily_workspace(
    pool: &SqlitePool,
    managed_project_id: &str,
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
    let member_ids: HashSet<&str> = members
        .iter()
        .map(|member| member.account_id.as_str())
        .collect();

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
    let sprints = client
        .list_active_sprints(board_id, 100)
        .await
        .map_err(|_| daily_error("remote_error", "Unable to load Jira sprints", true))?;
    let active_sprint = sprints
        .values
        .into_iter()
        .find(|sprint| sprint.state.eq_ignore_ascii_case("ACTIVE"))
        .ok_or_else(|| {
            daily_error(
                "not_found",
                "An active sprint was not found on the configured Jira board",
                false,
            )
        })?;
    let issues = client
        .list_sprint_issues_with_fields(
            &active_sprint.id,
            100,
            project
                .story_points_field_id
                .as_deref()
                .or(Some(DEFAULT_STORY_POINTS_FIELD_ID)),
        )
        .await
        .map_err(|_| daily_error("remote_error", "Unable to load active sprint issues", true))?;
    let subtasks = issues
        .values
        .into_iter()
        .filter_map(|issue| {
            daily_subtask(
                issue.id,
                issue.key,
                issue.fields,
                &member_ids,
                project
                    .story_points_field_id
                    .as_deref()
                    .or(Some(DEFAULT_STORY_POINTS_FIELD_ID)),
            )
        })
        .collect();

    Ok(DailyWorkspaceDto {
        managed_project_id: project.id,
        project_name: project.jira_project_name,
        project_key: project.jira_project_key,
        active_sprint_id: active_sprint.id,
        active_sprint_name: active_sprint.name,
        members,
        subtasks,
    })
}

pub async fn refresh_daily_workspace(
    pool: &SqlitePool,
    managed_project_id: &str,
    active_sprint_id: &str,
) -> Result<Vec<DailySubtaskDto>, PlanningCommandError> {
    if active_sprint_id.trim().is_empty() {
        return Err(daily_error(
            "invalid_input",
            "An active sprint is required",
            false,
        ));
    }
    let project = planning_repositories::get_managed_project(pool, managed_project_id)
        .await
        .map_err(|_| daily_error("not_found", "managed project was not found", false))?;
    ensure_daily_dependencies(pool, &project.integration_id).await?;
    let members = planning::list_configured_team_members(pool, managed_project_id).await?;
    let member_ids: HashSet<&str> = members
        .iter()
        .map(|member| member.account_id.as_str())
        .collect();
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
    let issues = client
        .list_sprint_issues_with_fields(
            active_sprint_id,
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
                "Unable to refresh active sprint issues",
                true,
            )
        })?;
    Ok(issues
        .values
        .into_iter()
        .filter_map(|issue| {
            daily_subtask(
                issue.id,
                issue.key,
                issue.fields,
                &member_ids,
                project
                    .story_points_field_id
                    .as_deref()
                    .or(Some(DEFAULT_STORY_POINTS_FIELD_ID)),
            )
        })
        .collect())
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
            "A working Jira integration is required for Daily",
            false,
        ));
    }
    crate::application::ai::ensure_review_ready(pool)
        .await
        .map(|_| ())
        .map_err(|message| daily_error("ai_unavailable", &message, false))
}

fn daily_subtask(
    id: String,
    key: String,
    fields: Value,
    member_ids: &HashSet<&str>,
    story_points_field_id: Option<&str>,
) -> Option<DailySubtaskDto> {
    let issue_type = fields.get("issuetype")?;
    if issue_type.get("subtask").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let assignee = fields.get("assignee")?;
    let assignee_account_id = first_string(assignee, &["accountId", "name", "key"])?;
    if !member_ids.contains(assignee_account_id.as_str()) {
        return None;
    }
    let summary = fields
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("Untitled sub-task")
        .to_owned();
    let status = fields
        .get("status")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown status")
        .to_owned();
    let parent_issue_key = fields
        .get("parent")
        .and_then(|value| value.get("key"))
        .and_then(Value::as_str)
        .map(str::to_owned);

    Some(DailySubtaskDto {
        id,
        key,
        summary,
        status,
        story_points: story_points_field_id.and_then(|field_id| field_i64(&fields, field_id)),
        assignee_account_id,
        parent_issue_key,
    })
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
    use super::daily_subtask;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn maps_an_assigned_jira_subtask_for_daily() {
        let subtask = daily_subtask(
            "10002".into(),
            "DEMO-2".into(),
            json!({
                "summary": "Implement API",
                "status": {"name": "In Progress"},
                "issuetype": {"subtask": true},
                "assignee": {"accountId": "test-user-a"},
                "parent": {"key": "DEMO-1"},
                "customfield_10016": 5.0
            }),
            &HashSet::from(["test-user-a"]),
            Some("customfield_10016"),
        )
        .expect("assigned Jira subtask should map");

        assert_eq!(subtask.key, "DEMO-2");
        assert_eq!(subtask.status, "In Progress");
        assert_eq!(subtask.assignee_account_id, "test-user-a");
        assert_eq!(subtask.story_points, Some(5));
    }
}
