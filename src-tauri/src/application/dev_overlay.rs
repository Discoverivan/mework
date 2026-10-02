use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::application::{
    confluence::{ConfluenceSearchRequest, ConfluenceSearchResponse, ConfluenceSpaceDto},
    daily::{DailySprintDto, DailySubtaskDto, DailyWorkspaceDto},
    data_integrations::settings::IntegrationDto,
    developer::{
        MyPullRequestDto, MyPullRequestsPageDto, PullRequestActivity, PullRequestReviewSummaryDto,
    },
    planning::{ManagedProjectDto, TeamMemberDto},
    task_tracker::{
        TaskTrackerChangeDto, TaskTrackerChangeKind, TaskTrackerEventKind, TaskTrackerIssueDto,
        TaskTrackerJqlPreviewDto, TaskTrackerMonitorDto, TaskTrackerScheduleKind,
        TaskTrackerSortDirection, TaskTrackerSortKey,
    },
};
use crate::domain::models::{Integration, IntegrationHealthStatus, IntegrationKind};
use crate::infrastructure::data_integrations::confluence::client::ConfluenceSearchResult;
use crate::infrastructure::db::repositories;
use sqlx::SqlitePool;

pub const MOCK_INTEGRATION_ID: &str = "mock-bitbucket";

#[derive(Debug, Clone)]
pub struct MockIntegrationUrls {
    pub jira: String,
    pub bitbucket: String,
    pub confluence: String,
}

pub fn mock_integration_urls_from_env() -> Result<MockIntegrationUrls, String> {
    let origin = std::env::var("MEWORK_MOCK_INTEGRATION_ORIGIN").map_err(|_| {
        "Mock integrations service URL is missing; use the --mock launcher".to_owned()
    })?;
    let origin = origin.trim_end_matches('/');
    if !origin.starts_with("http://127.0.0.1:")
        || origin["http://127.0.0.1:".len()..].parse::<u16>().is_err()
    {
        return Err("Mock integrations service must use a 127.0.0.1 URL".to_owned());
    }
    Ok(MockIntegrationUrls {
        jira: format!("{origin}/jira/"),
        bitbucket: format!("{origin}/bitbucket/"),
        confluence: format!("{origin}/confluence/"),
    })
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOverlaySnapshot {
    pub monitors: Vec<TaskTrackerMonitorDto>,
    pub parent_issues: Vec<MockOverlayParentIssueDto>,
    pub assignees: Vec<MockOverlayAssigneeDto>,
    pub sprints: Vec<MockOverlaySprintDto>,
    pub reviewer_pull_requests: MyPullRequestsPageDto,
    pub authored_pull_requests: MyPullRequestsPageDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockOverlayParentIssueDto {
    pub key: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockOverlayAssigneeDto {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockOverlaySprintDto {
    pub id: String,
    pub name: String,
    pub state: String,
}

#[derive(Debug, Clone)]
pub struct DevMockMode {
    enabled: bool,
}

#[derive(Debug, Clone)]
pub struct MockIntegrationState {
    enabled: bool,
    scenario: Arc<Mutex<Scenario>>,
}

#[derive(Debug, Clone)]
struct Scenario {
    monitor: TaskTrackerMonitorDto,
    reviewer_pull_requests: Vec<MyPullRequestDto>,
    authored_pull_requests: Vec<MyPullRequestDto>,
    pull_request_comments: HashMap<String, Vec<MockBitbucketComment>>,
    daily_issue_statuses: HashMap<String, String>,
    jira_issues: HashMap<String, MockJiraIssue>,
    next_pull_request_id: u64,
}

#[derive(Debug, Clone)]
struct MockJiraIssue {
    sprint_id: Option<String>,
    wire: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockBitbucketComment {
    pub id: u64,
    pub version: u64,
    pub text: String,
    pub created_date: i64,
    pub anchor: Option<Value>,
    pub parent_comment_id: Option<u64>,
}

impl DevMockMode {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn require_enabled(&self) -> Result<(), String> {
        if self.enabled {
            Ok(())
        } else {
            Err("Development mock mode is not enabled".to_owned())
        }
    }

    pub fn require_live_provider_access(&self) -> Result<(), String> {
        if self.enabled {
            Err("Live provider access is disabled in mock mode".to_owned())
        } else {
            Ok(())
        }
    }
}

impl MockIntegrationState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            scenario: Arc::new(Mutex::new(Scenario::default())),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn require_enabled(&self) -> Result<(), String> {
        if self.enabled {
            Ok(())
        } else {
            Err("Development mock mode is not enabled".to_owned())
        }
    }

    pub fn mock_integrations(&self) -> Result<Vec<IntegrationDto>, String> {
        self.require_enabled()?;
        let now = now_iso();
        Ok([
            (
                "mock-jira",
                IntegrationKind::Jira,
                "https://jira.example.invalid",
                json!({ "deployment": "data_center" }),
            ),
            (
                "mock-bitbucket",
                IntegrationKind::Bitbucket,
                "https://bitbucket.example.invalid",
                json!({ "deployment": "data_center" }),
            ),
            (
                "mock-confluence",
                IntegrationKind::Confluence,
                "https://confluence.example.invalid",
                json!({ "deployment": "data_center" }),
            ),
        ]
        .into_iter()
        .map(|(id, kind, base_url, capabilities)| IntegrationDto {
            id: id.to_owned(),
            kind,
            base_url: base_url.to_owned(),
            account_key: "example-account".to_owned(),
            credential_ref: format!("mock://{id}/no-credential"),
            enabled: true,
            allow_insecure_tls: false,
            account_display_name: Some("Example Account".to_owned()),
            health_status: IntegrationHealthStatus::Working,
            health_error: None,
            health_details: None,
            health_checked_at: Some(now.clone()),
            capabilities,
            last_success_at: Some(now.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .collect())
    }

    pub fn mock_managed_projects(&self) -> Result<Vec<ManagedProjectDto>, String> {
        self.require_enabled()?;
        let now = now_iso();
        Ok(vec![ManagedProjectDto {
            id: "mock-managed-project".to_owned(),
            integration_id: "mock-jira".to_owned(),
            project_id: "mock-project-id".to_owned(),
            project_key: "MOCK".to_owned(),
            project_name: "MOCK DATA — Example project".to_owned(),
            confluence_space: Some(ConfluenceSpaceDto {
                integration_id: "mock-confluence".to_owned(),
                space_id: "mock-space-1".to_owned(),
                space_key: "MOCK".to_owned(),
                space_name: "MOCK DATA — Example space".to_owned(),
            }),
            board_id: Some("mock-board-1".to_owned()),
            source_sprint_id: Some("1".to_owned()),
            source_sprint_name: Some("MOCK DATA — Current sprint".to_owned()),
            story_points_field_id: Some("mock-story-points".to_owned()),
            competency_field_id: None,
            subtask_issue_type_id: Some("mock-subtask".to_owned()),
            default_team_preset_id: None,
            default_task_sprint_id: Some("1".to_owned()),
            default_task_sprint_name: Some("MOCK DATA — Current sprint".to_owned()),
            default_epic_link_key: Some("MOCK-300".to_owned()),
            default_epic_link_summary: Some("MOCK DATA — Example epic".to_owned()),
            epic_link_jql: "project = MOCK AND issuetype = Epic".to_owned(),
            enabled: true,
            last_metadata_refresh_at: Some(now.clone()),
            created_at: now.clone(),
            updated_at: now,
        }])
    }

    pub fn mock_team_members(&self) -> Result<Vec<TeamMemberDto>, String> {
        self.require_enabled()?;
        Ok(synthetic_team_members())
    }

    pub fn mock_daily_workspace(
        &self,
        managed_project_id: &str,
        sprint_id: Option<&str>,
    ) -> Result<DailyWorkspaceDto, String> {
        self.require_enabled()?;
        if managed_project_id != "mock-managed-project" {
            return Err("Mock managed project was not found".to_owned());
        }
        let sprints = synthetic_daily_sprints();
        let selected_sprint_id = sprint_id
            .filter(|id| sprints.iter().any(|sprint| sprint.id == **id))
            .unwrap_or("1");
        let selected_sprint = sprints
            .iter()
            .find(|sprint| sprint.id == selected_sprint_id)
            .unwrap();
        let members = self.mock_team_members()?;
        let now = now_iso();
        Ok(DailyWorkspaceDto {
            managed_project_id: managed_project_id.to_owned(),
            project_name: "MOCK DATA — Example project".to_owned(),
            project_key: "MOCK".to_owned(),
            selected_sprint_id: selected_sprint.id.clone(),
            selected_sprint_name: selected_sprint.name.clone(),
            sprint_board_url:
                "https://jira.example.invalid/secure/RapidBoard.jspa?rapidView=mock-board-1"
                    .to_owned(),
            sprint_board_urls_by_assignee: Default::default(),
            sprints,
            members,
            subtasks: vec![
                DailySubtaskDto {
                    id: "mock-issue-201".to_owned(),
                    key: "MOCK-201".to_owned(),
                    summary: "MOCK DATA · Prepare example handoff".to_owned(),
                    status: "In Progress".to_owned(),
                    story_points: Some(3),
                    status_transition_at: Some(now.clone()),
                    assignee_account_id: Some("mock-user-a".to_owned()),
                    assignee_display_name: Some("Example Engineer A".to_owned()),
                    issue_type: "Sub-task".to_owned(),
                    parent_issue_key: Some("MOCK-200".to_owned()),
                    url: "https://jira.example.invalid/browse/MOCK-201".to_owned(),
                    parent_url: Some("https://jira.example.invalid/browse/MOCK-200".to_owned()),
                },
                DailySubtaskDto {
                    id: "mock-issue-202".to_owned(),
                    key: "MOCK-202".to_owned(),
                    summary: "MOCK DATA · Verify local scenario".to_owned(),
                    status: "To Do".to_owned(),
                    story_points: Some(2),
                    status_transition_at: Some(now.clone()),
                    assignee_account_id: Some("mock-user-b".to_owned()),
                    assignee_display_name: Some("Example Engineer B".to_owned()),
                    issue_type: "Sub-task".to_owned(),
                    parent_issue_key: Some("MOCK-200".to_owned()),
                    url: "https://jira.example.invalid/browse/MOCK-202".to_owned(),
                    parent_url: Some("https://jira.example.invalid/browse/MOCK-200".to_owned()),
                },
                DailySubtaskDto {
                    id: "mock-issue-203".to_owned(),
                    key: "MOCK-203".to_owned(),
                    summary: "MOCK DATA · Review sample workflow".to_owned(),
                    status: "Done".to_owned(),
                    story_points: Some(5),
                    status_transition_at: Some(now),
                    assignee_account_id: Some("mock-user-a".to_owned()),
                    assignee_display_name: Some("Example Engineer A".to_owned()),
                    issue_type: "Sub-task".to_owned(),
                    parent_issue_key: Some("MOCK-200".to_owned()),
                    url: "https://jira.example.invalid/browse/MOCK-203".to_owned(),
                    parent_url: Some("https://jira.example.invalid/browse/MOCK-200".to_owned()),
                },
            ],
        })
    }

    pub fn mock_confluence_search(
        &self,
        request: ConfluenceSearchRequest,
    ) -> Result<ConfluenceSearchResponse, String> {
        self.require_enabled()?;
        if request.integration_id != "mock-confluence" || request.query.trim().is_empty() {
            return Err("Mock Confluence search requires a query and mock integration".to_owned());
        }
        Ok(ConfluenceSearchResponse {
            integration_id: request.integration_id,
            results: vec![
                ConfluenceSearchResult {
                    id: "mock-page-1".to_owned(),
                    title: "MOCK DATA · Example runbook".to_owned(),
                    content_type: "page".to_owned(),
                    space_name: Some("MOCK DATA — Example space".to_owned()),
                    excerpt: Some(
                        "Synthetic page content for exercising search results.".to_owned(),
                    ),
                    url: Some(
                        "https://confluence.example.invalid/spaces/MOCK/pages/mock-page-1"
                            .to_owned(),
                    ),
                    last_modified: Some(now_iso()),
                },
                ConfluenceSearchResult {
                    id: "mock-page-2".to_owned(),
                    title: "MOCK DATA · Example project notes".to_owned(),
                    content_type: "page".to_owned(),
                    space_name: Some("MOCK DATA — Example space".to_owned()),
                    excerpt: Some(
                        "Synthetic project notes used by the development scenario.".to_owned(),
                    ),
                    url: Some(
                        "https://confluence.example.invalid/spaces/MOCK/pages/mock-page-2"
                            .to_owned(),
                    ),
                    last_modified: Some(now_iso()),
                },
            ]
            .into_iter()
            .take(request.limit as usize)
            .collect(),
        })
    }

    pub fn mock_confluence_space(
        &self,
        integration_id: &str,
        key_or_url: &str,
    ) -> Result<ConfluenceSpaceDto, String> {
        self.require_enabled()?;
        if integration_id != "mock-confluence" || key_or_url.trim().is_empty() {
            return Err("Mock Confluence space was not found".to_owned());
        }
        Ok(ConfluenceSpaceDto {
            integration_id: integration_id.to_owned(),
            space_id: "mock-space-1".to_owned(),
            space_key: "MOCK".to_owned(),
            space_name: "MOCK DATA — Example space".to_owned(),
        })
    }

    pub fn snapshot(&self) -> Result<DevOverlaySnapshot, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(scenario.snapshot())
    }

    pub fn monitors(&self) -> Result<Vec<TaskTrackerMonitorDto>, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(vec![scenario.monitor.clone()])
    }

    pub fn mock_task_tracker_jql_preview(
        &self,
        jql: &str,
    ) -> Result<TaskTrackerJqlPreviewDto, String> {
        self.require_enabled()?;
        if jql.trim().is_empty() {
            return Err("Enter JQL to preview synthetic issues".to_owned());
        }
        let issues: Vec<TaskTrackerIssueDto> = self
            .monitors()?
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .take(10)
            .collect();
        Ok(TaskTrackerJqlPreviewDto {
            issue_count: issues.len() as i64,
            truncated: false,
            issues,
        })
    }

    pub fn monitor(&self, id: &str) -> Result<TaskTrackerMonitorDto, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        if scenario.monitor.id != id {
            return Err("Mock task tracker monitor was not found".to_owned());
        }
        Ok(scenario.monitor.clone())
    }

    pub fn set_task_status(
        &self,
        issue_key: &str,
        status: &str,
    ) -> Result<DevOverlaySnapshot, String> {
        self.require_enabled()?;
        if !matches!(status, "To Do" | "In Progress" | "Done") {
            return Err("Choose a supported mock task status".to_owned());
        }
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let now = now_iso();
        for issue in &mut scenario.monitor.issues {
            issue.changed = false;
            issue.last_change = None;
        }
        let issue = scenario
            .monitor
            .issues
            .iter_mut()
            .find(|issue| issue.key == issue_key)
            .ok_or_else(|| "Mock task was not found".to_owned())?;
        let previous_status = std::mem::replace(&mut issue.status, status.to_owned());
        issue.changed = true;
        issue.last_change = Some(TaskTrackerChangeDto {
            kind: TaskTrackerChangeKind::Status,
            description: format!("Status changed: {previous_status} → {status}."),
            detected_at: now.clone(),
        });
        if let Some(mock_issue) = scenario.jira_issues.get_mut(issue_key) {
            mock_issue.wire["fields"]["status"]["name"] = Value::String(status.to_owned());
            mock_issue.wire["fields"]["updated"] = Value::String(now.clone());
        }
        scenario.monitor.last_success_at = Some(now);
        scenario.monitor.changes_after_last_check = 1;
        Ok(scenario.snapshot())
    }

    pub fn create_jira_issue(&self, fields: &Value) -> Result<(String, String), String> {
        self.create_jira_issue_with_sprint(fields, None)
    }

    pub fn create_jira_subtask(
        &self,
        parent_issue_key: &str,
        summary: &str,
        assignee_id: &str,
        sprint_id: &str,
    ) -> Result<(String, String), String> {
        self.require_enabled()?;
        let parent_issue_key = parent_issue_key.trim();
        let summary = summary.trim();
        if parent_issue_key.is_empty() || parent_issue_key.contains('/') {
            return Err("Choose a valid mock parent issue".to_owned());
        }
        if summary.is_empty() || summary.chars().count() > 255 {
            return Err("Enter a subtask summary of 1–255 characters".to_owned());
        }
        let assignee =
            mock_jira_user(assignee_id).ok_or_else(|| "Choose a mock Jira assignee".to_owned())?;
        if !matches!(sprint_id, "1" | "2") {
            return Err("Choose a mock Jira sprint".to_owned());
        }
        let fields = json!({
            "summary":summary,
            "issuetype":{"name":"Sub-task"},
            "parent":{"key":parent_issue_key},
            "assignee":{"name":assignee.0}
        });
        self.create_jira_issue_with_sprint(&fields, Some(sprint_id))
    }

    fn create_jira_issue_with_sprint(
        &self,
        fields: &Value,
        sprint_id: Option<&str>,
    ) -> Result<(String, String), String> {
        self.require_enabled()?;
        let summary = fields
            .get("summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|summary| !summary.is_empty() && summary.chars().count() <= 255)
            .ok_or_else(|| "A valid Jira issue summary is required".to_owned())?;
        let issue_type = fields
            .pointer("/issuetype/name")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Task");
        let is_subtask = issue_type.eq_ignore_ascii_case("Sub-task")
            || fields
                .pointer("/issuetype/subtask")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        let assignee = fields
            .get("assignee")
            .and_then(|value| value.get("name").or_else(|| value.get("accountId")))
            .and_then(Value::as_str)
            .and_then(mock_jira_user);
        if is_subtask && assignee.is_none() {
            return Err("A mock Jira subtask must have an assignee".to_owned());
        }
        let parent_issue_key = fields
            .pointer("/parent/key")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if is_subtask && parent_issue_key.is_none() {
            return Err("A mock Jira subtask must have a parent issue".to_owned());
        }
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let parent_summary = parent_issue_key.as_deref().and_then(|parent_key| {
            if let Some(issue) = scenario.jira_issues.get(parent_key) {
                if issue
                    .wire
                    .pointer("/fields/issuetype/subtask")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    return None;
                }
                return issue
                    .wire
                    .pointer("/fields/summary")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            scenario
                .monitor
                .issues
                .iter()
                .find(|issue| issue.key == parent_key)
                .map(|issue| issue.summary.clone())
        });
        if is_subtask && parent_summary.is_none() {
            return Err("The selected mock parent issue is unavailable".to_owned());
        }
        let next_number = scenario
            .monitor
            .issues
            .iter()
            .filter_map(|issue| issue.key.strip_prefix("MOCK-"))
            .filter_map(|number| number.parse::<u64>().ok())
            .max()
            .unwrap_or(100)
            .saturating_add(1);
        let key = format!("MOCK-{next_number}");
        let now = now_iso();
        for issue in &mut scenario.monitor.issues {
            issue.changed = false;
            issue.last_change = None;
        }
        scenario.monitor.issues.push(TaskTrackerIssueDto {
            key: key.clone(),
            summary: summary.to_owned(),
            status: "To Do".to_owned(),
            priority: fields
                .pointer("/priority/name")
                .and_then(Value::as_str)
                .unwrap_or("Medium")
                .to_owned(),
            assignee: assignee
                .as_ref()
                .map(|(_, display_name)| display_name.clone()),
            updated: Some(now.clone()),
            issue_url: format!("https://jira.example.invalid/browse/{key}"),
            last_change: Some(TaskTrackerChangeDto {
                kind: TaskTrackerChangeKind::New,
                description: "Synthetic task added in mock mode.".to_owned(),
                detected_at: now.clone(),
            }),
            changed: true,
        });
        scenario.monitor.current_issue_count = scenario.monitor.issues.len() as i64;
        scenario.monitor.changes_after_last_check = 1;
        scenario.monitor.last_success_at = Some(now.clone());
        let assignee_wire = assignee.map(|(account_id, display_name)| {
            json!({"accountId":account_id,"displayName":display_name,"active":true})
        });
        let mut issue_fields = json!({
            "summary": summary,
            "description": fields.get("description").cloned().unwrap_or(Value::Null),
            "status": {"name":"To Do"},
            "priority": {"name":fields.pointer("/priority/name").and_then(Value::as_str).unwrap_or("Medium")},
            "assignee": assignee_wire,
            "issuetype": {"name":issue_type,"subtask":is_subtask},
            "updated": now,
            "project": {"id":"mock-project-id","key":"MOCK","name":"Example project","projectTypeKey":"software"}
        });
        if let (Some(parent_issue_key), Some(parent_summary)) = (parent_issue_key, parent_summary) {
            issue_fields["parent"] = json!({
                "id":parent_issue_key,
                "key":parent_issue_key,
                "fields":{"summary":parent_summary}
            });
        }
        if let Some(points) = fields.get("mock-story-points") {
            issue_fields["mock-story-points"] = points.clone();
        }
        if let Some(epic) = fields.get("mock-epic-link").and_then(Value::as_str) {
            issue_fields["mock-epic-link"] = Value::String(epic.to_owned());
        }
        let wire = json!({"id":key,"key":key,"fields":issue_fields});
        scenario.jira_issues.insert(
            key.clone(),
            MockJiraIssue {
                sprint_id: sprint_id.map(str::to_owned),
                wire,
            },
        );
        Ok((key.clone(), key))
    }

    pub fn assign_jira_issues_to_sprint(
        &self,
        sprint_id: &str,
        keys: &[String],
    ) -> Result<(), String> {
        self.require_enabled()?;
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        for key in keys {
            let issue = scenario
                .jira_issues
                .get_mut(key)
                .ok_or_else(|| "Mock Jira issue was not found".to_owned())?;
            issue.sprint_id = Some(sprint_id.to_owned());
        }
        Ok(())
    }

    pub fn created_jira_issues(&self) -> Result<Vec<Value>, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(scenario
            .jira_issues
            .values()
            .map(|issue| issue.wire.clone())
            .collect())
    }

    pub fn created_jira_issue(&self, key: &str) -> Result<Option<Value>, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(scenario
            .jira_issues
            .get(key)
            .map(|issue| issue.wire.clone()))
    }

    pub fn created_jira_issues_for_sprint(&self, sprint_id: &str) -> Result<Vec<Value>, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(scenario
            .jira_issues
            .values()
            .filter(|issue| issue.sprint_id.as_deref() == Some(sprint_id))
            .map(|issue| issue.wire.clone())
            .collect())
    }

    pub fn add_task(&self, summary: &str) -> Result<DevOverlaySnapshot, String> {
        self.require_enabled()?;
        let summary = summary.trim();
        if summary.is_empty() || summary.chars().count() > 160 {
            return Err("Enter a mock task summary of 1–160 characters".to_owned());
        }
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let next_number = scenario
            .monitor
            .issues
            .iter()
            .filter_map(|issue| issue.key.strip_prefix("MOCK-"))
            .filter_map(|number| number.parse::<u64>().ok())
            .max()
            .unwrap_or(100)
            .saturating_add(1);
        let key = format!("MOCK-{next_number}");
        let now = now_iso();
        for issue in &mut scenario.monitor.issues {
            issue.changed = false;
            issue.last_change = None;
        }
        scenario.monitor.issues.push(TaskTrackerIssueDto {
            key: key.clone(),
            summary: summary.to_owned(),
            status: "To Do".to_owned(),
            priority: "Medium".to_owned(),
            assignee: None,
            updated: Some(now.clone()),
            issue_url: format!("https://jira.example.invalid/browse/{key}"),
            last_change: Some(TaskTrackerChangeDto {
                kind: TaskTrackerChangeKind::New,
                description: "Synthetic task added in mock mode.".to_owned(),
                detected_at: now.clone(),
            }),
            changed: true,
        });
        scenario.monitor.current_issue_count = scenario.monitor.issues.len() as i64;
        scenario.monitor.changes_after_last_check = 1;
        scenario.monitor.last_success_at = Some(now);
        Ok(scenario.snapshot())
    }

    pub fn add_pull_request(&self, authored: bool) -> Result<MyPullRequestsPageDto, String> {
        self.require_enabled()?;
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let id = scenario.next_pull_request_id;
        scenario.next_pull_request_id = scenario.next_pull_request_id.saturating_add(1);
        let value = mock_pull_request(id, authored, PullRequestActivity::New);
        let values = if authored {
            &mut scenario.authored_pull_requests
        } else {
            &mut scenario.reviewer_pull_requests
        };
        values.push(value);
        Ok(page(values.clone()))
    }

    pub fn reviewer_page(&self) -> Result<MyPullRequestsPageDto, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(page(scenario.reviewer_pull_requests.clone()))
    }

    pub fn authored_page(&self) -> Result<MyPullRequestsPageDto, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok(page(scenario.authored_pull_requests.clone()))
    }

    pub fn unread_counts(&self) -> Result<(u64, u64), String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        Ok((
            unread_count(&scenario.reviewer_pull_requests),
            unread_count(&scenario.authored_pull_requests),
        ))
    }

    pub fn mark_pull_request_read(
        &self,
        authored: bool,
        integration_id: &str,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: &str,
        latest_commit: Option<&str>,
    ) -> Result<bool, String> {
        self.require_enabled()?;
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let values = if authored {
            &mut scenario.authored_pull_requests
        } else {
            &mut scenario.reviewer_pull_requests
        };
        let Some(value) = values.iter_mut().find(|value| {
            value.integration_id == integration_id
                && value.project_key == project_key
                && value.repository_slug == repository_slug
                && (value.pull_request_id == pull_request_id
                    || format!(
                        "{}/{}/{}",
                        value.project_key, value.repository_slug, value.pull_request_id
                    ) == pull_request_id)
        }) else {
            return Ok(false);
        };
        if latest_commit.is_some() && value.latest_commit.as_deref() != latest_commit {
            return Ok(false);
        }
        value.activity = PullRequestActivity::Read;
        Ok(true)
    }

    pub fn mark_all_pull_requests_read(&self, authored: bool) -> Result<u64, String> {
        self.require_enabled()?;
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let values = if authored {
            &mut scenario.authored_pull_requests
        } else {
            &mut scenario.reviewer_pull_requests
        };
        let mut marked = 0;
        for value in values {
            if value.activity != PullRequestActivity::Read {
                value.activity = PullRequestActivity::Read;
                marked += 1;
            }
        }
        Ok(marked)
    }

    pub fn set_pull_request_decision(&self, id: &str, status: &str) -> Result<bool, String> {
        self.require_enabled()?;
        let decision = match status {
            "APPROVED" => "approved",
            "NEEDS_WORK" => "needs_work",
            _ => return Err("Unsupported mock pull request decision".to_owned()),
        };
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let value = if let Some(value) = scenario
            .reviewer_pull_requests
            .iter_mut()
            .find(|value| value.pull_request_id == id)
        {
            value
        } else {
            scenario
                .authored_pull_requests
                .iter_mut()
                .find(|value| value.pull_request_id == id)
                .ok_or_else(|| "Mock pull request was not found".to_owned())?
        };
        value.my_decision = decision.to_owned();
        value.review_summary.approved = u64::from(decision == "approved");
        value.review_summary.needs_work = u64::from(decision == "needs_work");
        Ok(true)
    }

    pub fn add_pull_request_comment(
        &self,
        id: &str,
        text: &str,
        anchor: Option<Value>,
        parent_comment_id: Option<u64>,
    ) -> Result<MockBitbucketComment, String> {
        self.require_enabled()?;
        if text.trim().is_empty() {
            return Err("Mock pull request comment must not be empty".to_owned());
        }
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        let exists = scenario
            .reviewer_pull_requests
            .iter()
            .chain(scenario.authored_pull_requests.iter())
            .any(|value| value.pull_request_id == id);
        if !exists {
            return Err("Mock pull request was not found".to_owned());
        }
        let comments = scenario
            .pull_request_comments
            .entry(id.to_owned())
            .or_default();
        let anchor = if let Some(parent_id) = parent_comment_id {
            comments
                .iter()
                .find(|comment| comment.id == parent_id)
                .ok_or("Mock reply target was not found")?
                .anchor
                .clone()
        } else {
            anchor
        };
        let comment = MockBitbucketComment {
            id: comments.len() as u64 + 1,
            version: 0,
            text: text.to_owned(),
            created_date: OffsetDateTime::now_utc()
                .unix_timestamp()
                .saturating_mul(1_000),
            anchor,
            parent_comment_id,
        };
        comments.push(comment.clone());
        let comments_count = comments.len() as u64;
        if let Some(value) = scenario
            .reviewer_pull_requests
            .iter_mut()
            .find(|value| value.pull_request_id == id)
        {
            value.review_summary.comments = comments_count;
        } else if let Some(value) = scenario
            .authored_pull_requests
            .iter_mut()
            .find(|value| value.pull_request_id == id)
        {
            value.review_summary.comments = comments_count;
        }
        Ok(comment)
    }

    pub fn pull_request_comments(&self, id: &str) -> Result<Vec<MockBitbucketComment>, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        let exists = scenario
            .reviewer_pull_requests
            .iter()
            .chain(scenario.authored_pull_requests.iter())
            .any(|value| value.pull_request_id == id);
        if !exists {
            return Err("Mock pull request was not found".to_owned());
        }
        Ok(scenario
            .pull_request_comments
            .get(id)
            .cloned()
            .unwrap_or_default())
    }

    pub fn daily_issue_status(&self, issue_key: &str) -> Result<String, String> {
        self.require_enabled()?;
        let scenario = self.scenario.lock().map_err(|_| state_error())?;
        scenario
            .daily_issue_statuses
            .get(issue_key)
            .cloned()
            .or_else(|| {
                scenario
                    .jira_issues
                    .get(issue_key)
                    .and_then(|issue| issue.wire.pointer("/fields/status/name"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .ok_or_else(|| "Mock Jira issue was not found".to_owned())
    }

    pub fn set_daily_issue_status(&self, issue_key: &str, status: &str) -> Result<(), String> {
        self.require_enabled()?;
        if !matches!(status, "To Do" | "In Progress" | "Done") {
            return Err("Choose a supported mock task status".to_owned());
        }
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        if let Some(current) = scenario.daily_issue_statuses.get_mut(issue_key) {
            *current = status.to_owned();
            return Ok(());
        }
        let issue = scenario
            .jira_issues
            .get_mut(issue_key)
            .ok_or_else(|| "Mock Jira issue was not found".to_owned())?;
        issue.wire["fields"]["status"]["name"] = Value::String(status.to_owned());
        issue.wire["fields"]["updated"] = Value::String(now_iso());
        Ok(())
    }

    pub fn reset(&self) -> Result<DevOverlaySnapshot, String> {
        self.require_enabled()?;
        let mut scenario = self.scenario.lock().map_err(|_| state_error())?;
        *scenario = Scenario::default();
        Ok(scenario.snapshot())
    }
}

impl Default for Scenario {
    fn default() -> Self {
        let now = now_iso();
        let mut issues = vec![
            mock_task(
                "MOCK-101",
                "MOCK DATA · Review sample workflow",
                "In Progress",
                true,
                &now,
            ),
            mock_task(
                "MOCK-102",
                "MOCK DATA · Prepare example release notes",
                "To Do",
                false,
                &now,
            ),
            mock_task(
                "MOCK-103",
                "MOCK DATA · Verify local scenario",
                "Done",
                false,
                &now,
            ),
            mock_task(
                "MOCK-104",
                "MOCK DATA · Triage a high-priority sample",
                "To Do",
                false,
                &now,
            ),
            mock_task(
                "MOCK-105",
                "MOCK DATA · Verify an example escalation",
                "In Progress",
                false,
                &now,
            ),
        ];
        for issue in &mut issues[3..] {
            issue.priority = "High".to_owned();
        }
        Self {
            monitor: TaskTrackerMonitorDto {
                id: "mock-task-tracker".to_owned(),
                name: "MOCK DATA — Sample tasks".to_owned(),
                jql: "project = MOCK".to_owned(),
                schedule_kind: TaskTrackerScheduleKind::Period,
                schedule_value: "300".to_owned(),
                tracked_events: vec![
                    TaskTrackerEventKind::NewIssues,
                    TaskTrackerEventKind::RemovedIssues,
                    TaskTrackerEventKind::StatusChanges,
                    TaskTrackerEventKind::NewComments,
                ],
                enabled: true,
                last_success_at: Some(now.clone()),
                next_check_at: None,
                current_issue_count: issues.len() as i64,
                changes_after_last_check: 1,
                max_tracked_issues: 100,
                exceeds_limit: false,
                last_error: None,
                sort_key: TaskTrackerSortKey::Updated,
                sort_direction: TaskTrackerSortDirection::Desc,
                issues,
            },
            reviewer_pull_requests: vec![
                mock_pull_request(41, false, PullRequestActivity::New),
                mock_pull_request(42, false, PullRequestActivity::Updated),
                mock_pull_request(43, false, PullRequestActivity::Read),
                mock_pull_request(44, false, PullRequestActivity::New),
                mock_pull_request(45, false, PullRequestActivity::New),
                mock_pull_request(46, false, PullRequestActivity::New),
            ],
            authored_pull_requests: vec![
                mock_pull_request(51, true, PullRequestActivity::Updated),
                mock_pull_request(52, true, PullRequestActivity::Read),
            ],
            pull_request_comments: (41..=46).map(|id| {
                let comments = super::mock_reviews::findings(id).into_iter().filter_map(|fixture| {
                    fixture.existing.map(|text| MockBitbucketComment {
                        id: 0, version: 0, text, parent_comment_id: None,
                        created_date: OffsetDateTime::now_utc().unix_timestamp() * 1_000,
                        anchor: Some(json!({"path": fixture.finding.file, "line": 1, "lineType": "ADDED", "fileType": "TO"})),
                    })
                }).enumerate().map(|(index, mut comment)| { comment.id = index as u64 + 1; comment }).collect();
                (id.to_string(), comments)
            }).collect(),
            daily_issue_statuses: HashMap::from([(
                "MOCK-201".to_owned(),
                "In Progress".to_owned(),
            )]),
            jira_issues: HashMap::new(),
            next_pull_request_id: 100,
        }
    }
}

impl Scenario {
    fn snapshot(&self) -> DevOverlaySnapshot {
        let parent_issues = self
            .monitor
            .issues
            .iter()
            .filter(|issue| {
                !self
                    .jira_issues
                    .get(&issue.key)
                    .and_then(|mock_issue| mock_issue.wire.pointer("/fields/issuetype/subtask"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .map(|issue| MockOverlayParentIssueDto {
                key: issue.key.clone(),
                summary: issue.summary.clone(),
            })
            .collect();
        DevOverlaySnapshot {
            monitors: vec![self.monitor.clone()],
            parent_issues,
            assignees: synthetic_team_members()
                .into_iter()
                .map(|member| MockOverlayAssigneeDto {
                    id: member.account_id,
                    display_name: member.alias.unwrap_or(member.display_name),
                })
                .collect(),
            sprints: synthetic_daily_sprints()
                .into_iter()
                .map(|sprint| MockOverlaySprintDto {
                    id: sprint.id,
                    name: sprint.name,
                    state: sprint.state,
                })
                .collect(),
            reviewer_pull_requests: page(self.reviewer_pull_requests.clone()),
            authored_pull_requests: page(self.authored_pull_requests.clone()),
        }
    }
}

fn synthetic_team_members() -> Vec<TeamMemberDto> {
    vec![
        TeamMemberDto {
            account_id: "mock-user-a".to_owned(),
            display_name: "Example Engineer A".to_owned(),
            alias: Some("Engineer A".to_owned()),
            avatar_url: None,
            active: true,
            tags: vec!["backend".to_owned()],
            display_order: 0,
        },
        TeamMemberDto {
            account_id: "mock-user-b".to_owned(),
            display_name: "Example Engineer B".to_owned(),
            alias: Some("Engineer B".to_owned()),
            avatar_url: None,
            active: true,
            tags: vec!["frontend".to_owned()],
            display_order: 1,
        },
    ]
}

fn synthetic_daily_sprints() -> Vec<DailySprintDto> {
    vec![
        DailySprintDto {
            id: "1".to_owned(),
            name: "Current sprint".to_owned(),
            state: "active".to_owned(),
            start_date: Some("2026-09-21T00:00:00.000Z".to_owned()),
            end_date: Some("2026-10-05T00:00:00.000Z".to_owned()),
        },
        DailySprintDto {
            id: "2".to_owned(),
            name: "Next sprint".to_owned(),
            state: "future".to_owned(),
            start_date: Some("2026-10-06T00:00:00.000Z".to_owned()),
            end_date: Some("2026-10-20T00:00:00.000Z".to_owned()),
        },
    ]
}

fn mock_jira_user(name: &str) -> Option<(String, String)> {
    match name {
        "mock-user-a" | "Example Engineer A" => {
            Some(("mock-user-a".to_owned(), "Example Engineer A".to_owned()))
        }
        "mock-user-b" | "Example Engineer B" => {
            Some(("mock-user-b".to_owned(), "Example Engineer B".to_owned()))
        }
        _ => None,
    }
}

fn mock_task(
    key: &str,
    summary: &str,
    status: &str,
    changed: bool,
    now: &str,
) -> TaskTrackerIssueDto {
    TaskTrackerIssueDto {
        key: key.to_owned(),
        summary: summary.to_owned(),
        status: status.to_owned(),
        priority: "Medium".to_owned(),
        assignee: None,
        updated: Some(now.to_owned()),
        issue_url: format!("https://jira.example.invalid/browse/{key}"),
        last_change: changed.then(|| TaskTrackerChangeDto {
            kind: TaskTrackerChangeKind::Status,
            description: "Status changed: To Do → In Progress.".to_owned(),
            detected_at: now.to_owned(),
        }),
        changed,
    }
}

fn mock_pull_request(id: u64, authored: bool, activity: PullRequestActivity) -> MyPullRequestDto {
    let now = OffsetDateTime::now_utc()
        .unix_timestamp()
        .saturating_mul(1_000);
    MyPullRequestDto {
        integration_id: MOCK_INTEGRATION_ID.to_owned(),
        pull_request_id: id.to_string(),
        title: if let Some(title) = super::mock_reviews::title(id).filter(|_| !authored) {
            format!("MOCK DATA — {title}")
        } else if authored {
            format!("MOCK DATA — Example authored change {id}")
        } else {
            format!("MOCK DATA — Example review request {id}")
        },
        state: "OPEN".to_owned(),
        repository_slug: "sample-repository".to_owned(),
        repository_name: "Sample repository".to_owned(),
        project_key: "MOCK".to_owned(),
        source_branch: "feature/example".to_owned(),
        target_branch: "main".to_owned(),
        author_display_name: "Example Author".to_owned(),
    updated_date: Some(now),
        url: Some(format!(
            "https://bitbucket.example.invalid/projects/MOCK/repos/sample-repository/pull-requests/{id}/overview"
        )),
        my_decision: if authored || id == 41 { "approved" } else { "not_reviewed" }.to_owned(),
        author_avatar_url: None,
        latest_commit: Some(format!("mock-commit-{id}")),
        review_summary: PullRequestReviewSummaryDto {
            approved: u64::from(authored || id == 41),
            comments: super::mock_reviews::findings(id).iter().filter(|fixture| fixture.existing.is_some()).count() as u64,
            ..PullRequestReviewSummaryDto::default()
        },
        needs_action: !authored && id != 41,
        activity,
        review: super::mock_reviews::review(id, now),
    }
}

fn page(values: Vec<MyPullRequestDto>) -> MyPullRequestsPageDto {
    MyPullRequestsPageDto {
        total: Some(values.len() as u64),
        next_start: None,
        has_more: false,
        last_updated_at: Some(OffsetDateTime::now_utc().unix_timestamp_nanos() as i64 / 1_000_000),
        values,
    }
}

fn unread_count(values: &[MyPullRequestDto]) -> u64 {
    values
        .iter()
        .filter(|value| value.activity != PullRequestActivity::Read)
        .count() as u64
}

pub async fn persist_mock_task_tracker_snapshot(
    pool: &SqlitePool,
    monitor: &TaskTrackerMonitorDto,
) -> Result<(), String> {
    let now = now_iso();
    let last_success_at = monitor.last_success_at.clone();
    let tracked_events = serde_json::to_string(&monitor.tracked_events)
        .map_err(|_| "mock monitor events could not be encoded".to_owned())?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "mock monitor state could not be saved".to_owned())?;
    sqlx::query(
        "INSERT INTO task_monitors
            (id, integration_id, name, jql, schedule_kind, schedule_value, tracked_events_json,
             enabled, last_success_at, next_check_at_ms, current_issue_count,
             changes_after_last_check, last_error, created_at, updated_at,
             max_tracked_issues, exceeds_limit)
         VALUES (?, 'mock-jira', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
             integration_id = excluded.integration_id, name = excluded.name, jql = excluded.jql,
             schedule_kind = excluded.schedule_kind, schedule_value = excluded.schedule_value,
             tracked_events_json = excluded.tracked_events_json, enabled = excluded.enabled,
             last_success_at = excluded.last_success_at, next_check_at_ms = excluded.next_check_at_ms,
             current_issue_count = excluded.current_issue_count,
             changes_after_last_check = excluded.changes_after_last_check,
             last_error = excluded.last_error, updated_at = excluded.updated_at,
             max_tracked_issues = excluded.max_tracked_issues, exceeds_limit = excluded.exceeds_limit",
    )
    .bind(&monitor.id)
    .bind(&monitor.name)
    .bind(&monitor.jql)
    .bind(match monitor.schedule_kind {
        TaskTrackerScheduleKind::Period => "period",
        TaskTrackerScheduleKind::Cron => "cron",
    })
    .bind(&monitor.schedule_value)
    .bind(tracked_events)
    .bind(monitor.enabled)
    .bind(&last_success_at)
    .bind(monitor.next_check_at)
    .bind(monitor.current_issue_count)
    .bind(monitor.changes_after_last_check)
    .bind(&monitor.last_error)
    .bind(last_success_at.as_deref().unwrap_or(&now))
    .bind(&now)
    .bind(monitor.max_tracked_issues)
    .bind(monitor.exceeds_limit)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "mock monitor state could not be saved".to_owned())?;

    sqlx::query("DELETE FROM task_monitor_issues WHERE monitor_id = ?")
        .bind(&monitor.id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "mock monitor issues could not be replaced".to_owned())?;
    for issue in &monitor.issues {
        let change = issue.last_change.as_ref();
        sqlx::query(
            "INSERT INTO task_monitor_issues
                (monitor_id, issue_id, issue_key, summary, status, priority, assignee, updated,
                 comment_count, issue_url, present, last_change_type, last_change_description,
                 last_changed_at, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?)",
        )
        .bind(&monitor.id)
        .bind(&issue.key)
        .bind(&issue.key)
        .bind(&issue.summary)
        .bind(&issue.status)
        .bind(&issue.priority)
        .bind(&issue.assignee)
        .bind(&issue.updated)
        .bind(&issue.issue_url)
        .bind(change.map(|change| match change.kind {
            TaskTrackerChangeKind::New => "new",
            TaskTrackerChangeKind::Removed => "removed",
            TaskTrackerChangeKind::Status => "status",
            TaskTrackerChangeKind::Comment => "comment",
        }))
        .bind(change.map(|change| change.description.as_str()))
        .bind(change.map(|change| change.detected_at.as_str()))
        .bind(issue.updated.as_deref().unwrap_or(&now))
        .execute(&mut *transaction)
        .await
        .map_err(|_| "mock monitor issues could not be saved".to_owned())?;
    }
    transaction
        .commit()
        .await
        .map_err(|_| "mock monitor state could not be committed".to_owned())
}

async fn seed_mock_task_tracker(pool: &SqlitePool) -> Result<(), String> {
    let mut monitors = MockIntegrationState::new(true).monitors()?;
    for monitor in &mut monitors {
        monitor.issues.clear();
        monitor.current_issue_count = 0;
        monitor.changes_after_last_check = 0;
        monitor.last_success_at = None;
    }
    monitors.push(TaskTrackerMonitorDto {
        id: "mock-task-tracker-priority".to_owned(),
        name: "MOCK DATA — High-priority triage".to_owned(),
        jql: "project = MOCK AND priority = High".to_owned(),
        schedule_kind: TaskTrackerScheduleKind::Period,
        schedule_value: "900".to_owned(),
        tracked_events: vec![
            TaskTrackerEventKind::NewIssues,
            TaskTrackerEventKind::StatusChanges,
        ],
        enabled: true,
        last_success_at: None,
        next_check_at: None,
        current_issue_count: 0,
        changes_after_last_check: 0,
        max_tracked_issues: 100,
        exceeds_limit: false,
        last_error: None,
        sort_key: TaskTrackerSortKey::Updated,
        sort_direction: TaskTrackerSortDirection::Desc,
        issues: Vec::new(),
    });
    for monitor in monitors {
        persist_mock_task_tracker_snapshot(pool, &monitor).await?;
    }
    Ok(())
}

pub async fn seed_mock_settings(
    pool: &SqlitePool,
    mock_urls: Option<&MockIntegrationUrls>,
) -> Result<(), String> {
    let mode = MockIntegrationState::new(true);
    for fixture in mode.mock_integrations()? {
        let base_url = mock_urls
            .map(|urls| match fixture.kind {
                IntegrationKind::Jira => urls.jira.clone(),
                IntegrationKind::Bitbucket => urls.bitbucket.clone(),
                IntegrationKind::Confluence => urls.confluence.clone(),
            })
            .unwrap_or_else(|| fixture.base_url.clone());
        let integration = Integration {
            id: fixture.id,
            kind: fixture.kind,
            base_url,
            account_key: fixture.account_key,
            credential_ref: fixture.credential_ref,
            enabled: fixture.enabled,
            allow_insecure_tls: fixture.allow_insecure_tls,
            account_display_name: fixture.account_display_name,
            health_status: fixture.health_status,
            health_error: fixture.health_error,
            health_details: fixture.health_details,
            health_checked_at: fixture.health_checked_at,
            capabilities_json: fixture.capabilities.to_string(),
            last_success_at: fixture.last_success_at,
            created_at: fixture.created_at,
            updated_at: fixture.updated_at,
        };
        repositories::insert_integration(pool, &integration)
            .await
            .map_err(|_| "failed to seed mock integration settings".to_owned())?;
    }
    let managed_project = mode
        .mock_managed_projects()?
        .into_iter()
        .next()
        .ok_or_else(|| "mock managed project fixture is missing".to_owned())?;
    crate::application::planning::save_managed_project(
        pool,
        crate::application::planning::ManagedProjectRequest {
            id: Some(managed_project.id.clone()),
            integration_id: managed_project.integration_id,
            jira_project_id: managed_project.project_id,
            jira_project_key: managed_project.project_key,
            jira_project_name: managed_project.project_name,
            confluence_space: managed_project.confluence_space,
            board_id: managed_project.board_id,
            source_sprint_id: managed_project.source_sprint_id,
            source_sprint_name: managed_project.source_sprint_name,
            story_points_field_id: managed_project.story_points_field_id,
            competency_field_id: managed_project.competency_field_id,
            subtask_issue_type_id: managed_project.subtask_issue_type_id,
            default_team_preset_id: managed_project.default_team_preset_id,
            default_task_sprint_id: managed_project.default_task_sprint_id,
            default_task_sprint_name: managed_project.default_task_sprint_name,
            default_epic_link_key: managed_project.default_epic_link_key,
            default_epic_link_summary: managed_project.default_epic_link_summary,
            epic_link_jql: managed_project.epic_link_jql,
            enabled: managed_project.enabled,
        },
    )
    .await
    .map_err(|_| "failed to seed mock managed project".to_owned())?;
    for member in mode.mock_team_members()? {
        crate::application::planning::add_team_member(
            pool,
            crate::application::planning::TeamMemberAddRequest {
                managed_project_id: managed_project.id.clone(),
                account_id: member.account_id,
                display_name: member.display_name,
                alias: member.alias,
                avatar_url: member.avatar_url,
                role: member
                    .tags
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "example".to_owned()),
            },
        )
        .await
        .map_err(|_| "failed to seed mock planning team".to_owned())?;
    }
    repositories::upsert_setting(
        pool,
        "dev.mock.settings",
        r#"{"schemaVersion":1,"dataSource":"synthetic","integrationIds":["mock-jira","mock-bitbucket","mock-confluence"]}"#,
        1,
    )
    .await
    .map_err(|_| "failed to seed mock scenario settings".to_owned())?;
    super::developer_review::seed_mock_reviews(pool, &mode.reviewer_page()?.values).await?;
    seed_mock_task_tracker(pool).await
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn state_error() -> String {
    "Development mock scenario is unavailable".to_owned()
}

pub fn mock_mode_requested(debug_build: bool, selector: Option<&str>) -> bool {
    debug_build && selector == Some("1")
}

pub fn current_mock_mode_requested() -> bool {
    mock_mode_requested(
        cfg!(debug_assertions),
        std::env::var("MEWORK_DEV_MOCK_MODE").ok().as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        mock_mode_requested, persist_mock_task_tracker_snapshot, seed_mock_settings,
        MockIntegrationState,
    };
    use crate::infrastructure::db::{open_database, repositories};

    #[tokio::test]
    async fn startup_seed_writes_mock_integrations_to_the_database() {
        let temp_dir = tempfile::tempdir().expect("temporary mock app data");
        let regular_pool = open_database(&temp_dir.path().join("mework.sqlite"))
            .await
            .expect("regular development database");
        repositories::upsert_setting(
            &regular_pool,
            "ai.settings",
            r#"{"provider":"codex-cli","model":"example-model"}"#,
            1,
        )
        .await
        .expect("save regular development AI setting");
        let regular_ai_settings = repositories::get_setting(&regular_pool, "ai.settings")
            .await
            .expect("read regular development AI setting");
        drop(regular_pool);

        let pool = open_database(&temp_dir.path().join("mework-mock.sqlite"))
            .await
            .expect("mock database migrations");

        let mock_urls = super::MockIntegrationUrls {
            jira: "http://127.0.0.1:43210/jira/".to_owned(),
            bitbucket: "http://127.0.0.1:43210/bitbucket/".to_owned(),
            confluence: "http://127.0.0.1:43210/confluence/".to_owned(),
        };
        seed_mock_settings(&pool, Some(&mock_urls))
            .await
            .expect("seed mock settings");

        let integrations = repositories::list_integrations(&pool)
            .await
            .expect("read seeded integrations");
        let ids = integrations
            .iter()
            .map(|integration| integration.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            ids,
            ["mock-jira", "mock-bitbucket", "mock-confluence"].into()
        );
        assert_eq!(
            integrations
                .iter()
                .map(|integration| integration.base_url.as_str())
                .collect::<std::collections::HashSet<_>>(),
            [
                mock_urls.jira.as_str(),
                mock_urls.bitbucket.as_str(),
                mock_urls.confluence.as_str(),
            ]
            .into()
        );
        let settings = repositories::get_setting(&pool, "dev.mock.settings")
            .await
            .expect("read mock settings");
        assert!(settings.unwrap().contains("synthetic"));
        assert!(repositories::get_setting(&pool, "ai.settings")
            .await
            .expect("mock AI settings before CLI detection")
            .is_none());
        assert!(repositories::get_setting(&pool, "ai.openai-compatible")
            .await
            .expect("mock API providers")
            .is_none());
        let regular_pool = open_database(&temp_dir.path().join("mework.sqlite"))
            .await
            .expect("reopen regular development database");
        assert_eq!(
            repositories::get_setting(&regular_pool, "ai.settings")
                .await
                .expect("regular AI settings remain intact"),
            regular_ai_settings
        );

        let monitors = crate::application::task_tracker::list_monitors(&pool)
            .await
            .expect("list seeded Task Tracker monitors");
        assert_eq!(monitors.len(), 2);
        assert!(monitors.iter().all(|monitor| monitor.enabled));
        assert!(monitors
            .iter()
            .all(|monitor| monitor.issues.is_empty() && monitor.jql.contains("project = MOCK")));
    }

    #[tokio::test]
    async fn overlay_task_mutations_are_visible_through_the_task_tracker_database_read() {
        let temp_dir = tempfile::tempdir().expect("temporary mock app data");
        let pool = open_database(&temp_dir.path().join("mework-mock.sqlite"))
            .await
            .expect("mock database migrations");
        seed_mock_settings(&pool, None)
            .await
            .expect("seed mock settings");
        let mode = MockIntegrationState::new(true);

        let snapshot = mode
            .add_task("MOCK DATA · Added from overlay")
            .expect("add synthetic Jira issue");
        persist_mock_task_tracker_snapshot(&pool, &snapshot.monitors[0])
            .await
            .expect("persist only mock monitor data");

        let monitors = crate::application::task_tracker::list_monitors(&pool)
            .await
            .expect("read monitors through normal Task Tracker service");
        let primary = monitors
            .iter()
            .find(|monitor| monitor.id == "mock-task-tracker")
            .expect("primary sample monitor");
        assert!(primary
            .issues
            .iter()
            .any(|issue| issue.key == "MOCK-106"
                && issue.summary == "MOCK DATA · Added from overlay"));
        assert_eq!(monitors.len(), 2, "other seeded monitors remain intact");
    }

    #[test]
    fn mock_provider_data_covers_integrations_managed_projects_daily_and_confluence() {
        let mode = MockIntegrationState::new(true);
        let integrations = mode.mock_integrations().unwrap();
        assert_eq!(integrations.len(), 3);
        assert_eq!(
            integrations
                .iter()
                .find(|integration| integration.kind == crate::domain::models::IntegrationKind::Jira)
                .and_then(|integration| integration.capabilities.get("deployment"))
                .and_then(serde_json::Value::as_str),
            Some("data_center")
        );
        assert!(integrations.iter().all(|integration| {
            integration.enabled
                && integration.health_status
                    == crate::domain::models::IntegrationHealthStatus::Working
                && integration.base_url.ends_with(".example.invalid")
                && integration.credential_ref.starts_with("mock://")
        }));

        let projects = mode.mock_managed_projects().unwrap();
        assert_eq!(projects[0].integration_id, "mock-jira");
        assert_eq!(
            projects[0]
                .confluence_space
                .as_ref()
                .unwrap()
                .integration_id,
            "mock-confluence"
        );
    }

    #[test]
    fn mock_task_tracker_jql_preview_uses_only_synthetic_issues() {
        let mode = MockIntegrationState::new(true);
        let preview = mode
            .mock_task_tracker_jql_preview("project = MOCK")
            .unwrap();

        assert_eq!(preview.issue_count as usize, preview.issues.len());
        assert!(!preview.issues.is_empty());
        assert!(preview
            .issues
            .iter()
            .all(|issue| issue.issue_url.starts_with("https://jira.example.invalid/")));
    }

    #[test]
    fn mock_mode_requires_an_explicit_selector_and_debug_build() {
        assert!(!mock_mode_requested(true, None));
        assert!(!mock_mode_requested(true, Some("0")));
        assert!(!mock_mode_requested(false, Some("1")));
        assert!(mock_mode_requested(true, Some("1")));
    }

    #[test]
    fn status_mutation_is_local_and_updates_only_the_selected_task() {
        let mode = MockIntegrationState::new(true);
        let changed = mode.set_task_status("MOCK-102", "In Progress").unwrap();
        let monitor = &changed.monitors[0];
        assert_eq!(monitor.issues[1].status, "In Progress");
        assert!(monitor.issues[1].changed);
        assert_eq!(
            monitor.issues.iter().filter(|issue| issue.changed).count(),
            1
        );
        assert!(monitor
            .issues
            .iter()
            .all(|issue| issue.issue_url.starts_with("https://jira.example.invalid/")));
    }

    #[test]
    fn added_pull_request_is_local_and_mark_read_updates_unread_counts() {
        let mode = MockIntegrationState::new(true);
        let request = mode.add_pull_request(false).unwrap();
        let value = request.values.last().unwrap();
        assert_eq!(
            value.activity,
            crate::application::developer::PullRequestActivity::New
        );
        assert_eq!(value.integration_id, "mock-bitbucket");
        assert!(value
            .url
            .as_deref()
            .unwrap()
            .starts_with("https://bitbucket.example.invalid/"));
        let marked = mode
            .mark_pull_request_read(
                false,
                &value.integration_id,
                &value.project_key,
                &value.repository_slug,
                &value.pull_request_id,
                value.latest_commit.as_deref(),
            )
            .unwrap();
        assert!(marked);
        assert_eq!(mode.unread_counts().unwrap().0, 5);
    }

    #[test]
    fn release_guard_rejects_mock_mutations() {
        let mode = MockIntegrationState::new(false);
        assert!(mode.snapshot().is_err());
        assert!(mode.add_task("synthetic task").is_err());
    }
}
