use std::sync::Mutex;

use serde::Serialize;
use serde_json::json;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::application::{
    confluence::{ConfluenceSearchRequest, ConfluenceSearchResponse, ConfluenceSpaceDto},
    daily::{DailySprintDto, DailySubtaskDto, DailyWorkspaceDto},
    developer::{
        MyPullRequestDto, MyPullRequestsPageDto, PullRequestActivity, PullRequestReviewSummaryDto,
    },
    integrations::settings::IntegrationDto,
    planning::{
        ManagedProjectDto, PlanningAvailability, PlanningManagedProjectDto, PlanningSprintDto,
        TeamMemberDto,
    },
    task_tracker::{
        TaskTrackerChangeDto, TaskTrackerChangeKind, TaskTrackerEventKind, TaskTrackerIssueDto,
        TaskTrackerJqlPreviewDto, TaskTrackerMonitorDto, TaskTrackerScheduleKind,
    },
};
use crate::domain::models::{Integration, IntegrationHealthStatus, IntegrationKind};
use crate::infrastructure::db::repositories;
use crate::infrastructure::integrations::confluence::client::ConfluenceSearchResult;
use sqlx::SqlitePool;

pub const MOCK_INTEGRATION_ID: &str = "mock-bitbucket";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevOverlaySnapshot {
    pub monitors: Vec<TaskTrackerMonitorDto>,
    pub reviewer_pull_requests: MyPullRequestsPageDto,
    pub authored_pull_requests: MyPullRequestsPageDto,
}

#[derive(Debug)]
pub struct DevMockMode {
    enabled: bool,
    scenario: Mutex<Scenario>,
}

#[derive(Debug, Clone)]
struct Scenario {
    monitor: TaskTrackerMonitorDto,
    reviewer_pull_requests: Vec<MyPullRequestDto>,
    authored_pull_requests: Vec<MyPullRequestDto>,
    next_pull_request_id: u64,
}

impl DevMockMode {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            scenario: Mutex::new(Scenario::default()),
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

    pub fn require_live_provider_access(&self) -> Result<(), String> {
        if self.enabled {
            Err("Live provider access is disabled in mock mode".to_owned())
        } else {
            Ok(())
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
            source_sprint_id: Some("mock-sprint-active".to_owned()),
            source_sprint_name: Some("MOCK DATA — Current sprint".to_owned()),
            story_points_field_id: Some("mock-story-points".to_owned()),
            competency_field_id: None,
            subtask_issue_type_id: Some("mock-subtask".to_owned()),
            default_team_preset_id: None,
            default_task_sprint_id: Some("mock-sprint-active".to_owned()),
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

    pub fn mock_planning_projects(&self) -> Result<Vec<PlanningManagedProjectDto>, String> {
        self.require_enabled()?;
        Ok(vec![PlanningManagedProjectDto {
            id: "mock-managed-project".to_owned(),
            integration_id: "mock-jira".to_owned(),
            jira_project_id: "mock-project-id".to_owned(),
            name: "MOCK DATA — Example project".to_owned(),
            board_id: "mock-board-1".to_owned(),
            board_name: "MOCK DATA — Example board".to_owned(),
            source_sprint_id: Some("mock-sprint-active".to_owned()),
            source_sprint_name: Some("MOCK DATA — Current sprint".to_owned()),
            story_points_field_id: Some("mock-story-points".to_owned()),
            default_task_sprint_id: Some("mock-sprint-active".to_owned()),
            default_task_sprint_name: Some("MOCK DATA — Current sprint".to_owned()),
            default_epic_link_key: Some("MOCK-300".to_owned()),
            default_epic_link_summary: Some("MOCK DATA — Example epic".to_owned()),
            epic_link_jql: "project = MOCK AND issuetype = Epic".to_owned(),
            availability: PlanningAvailability::Available,
        }])
    }

    pub fn mock_team_members(&self) -> Result<Vec<TeamMemberDto>, String> {
        self.require_enabled()?;
        Ok(vec![
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
        ])
    }

    pub fn mock_target_sprints(
        &self,
        managed_project_id: &str,
    ) -> Result<Vec<PlanningSprintDto>, String> {
        self.require_enabled()?;
        if managed_project_id != "mock-managed-project" {
            return Err("Mock managed project was not found".to_owned());
        }
        Ok(vec![
            PlanningSprintDto {
                id: "mock-sprint-active".to_owned(),
                board_id: "mock-board-1".to_owned(),
                name: "MOCK DATA — Current sprint".to_owned(),
                state: "active".to_owned(),
                usable: true,
                start_date: Some("2026-09-21".to_owned()),
                end_date: Some("2026-10-05".to_owned()),
                availability: PlanningAvailability::Available,
            },
            PlanningSprintDto {
                id: "mock-sprint-next".to_owned(),
                board_id: "mock-board-1".to_owned(),
                name: "MOCK DATA — Next sprint".to_owned(),
                state: "future".to_owned(),
                usable: true,
                start_date: Some("2026-10-06".to_owned()),
                end_date: Some("2026-10-20".to_owned()),
                availability: PlanningAvailability::Available,
            },
        ])
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
        let sprints = vec![
            DailySprintDto {
                id: "mock-sprint-active".to_owned(),
                name: "MOCK DATA — Current sprint".to_owned(),
                state: "active".to_owned(),
            },
            DailySprintDto {
                id: "mock-sprint-next".to_owned(),
                name: "MOCK DATA — Next sprint".to_owned(),
                state: "future".to_owned(),
            },
        ];
        let selected_sprint_id = sprint_id
            .filter(|id| sprints.iter().any(|sprint| sprint.id == **id))
            .unwrap_or("mock-sprint-active");
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
        scenario.monitor.last_success_at = Some(now);
        scenario.monitor.changes_after_last_check = 1;
        Ok(scenario.snapshot())
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
                current_issue_count: 3,
                changes_after_last_check: 1,
                max_tracked_issues: 100,
                exceeds_limit: false,
                last_error: None,
                issues: vec![
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
                ],
            },
            reviewer_pull_requests: vec![
                mock_pull_request(41, false, PullRequestActivity::New),
                mock_pull_request(42, false, PullRequestActivity::Updated),
                mock_pull_request(43, false, PullRequestActivity::Read),
            ],
            authored_pull_requests: vec![
                mock_pull_request(51, true, PullRequestActivity::Updated),
                mock_pull_request(52, true, PullRequestActivity::Read),
            ],
            next_pull_request_id: 100,
        }
    }
}

impl Scenario {
    fn snapshot(&self) -> DevOverlaySnapshot {
        DevOverlaySnapshot {
            monitors: vec![self.monitor.clone()],
            reviewer_pull_requests: page(self.reviewer_pull_requests.clone()),
            authored_pull_requests: page(self.authored_pull_requests.clone()),
        }
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
        title: if authored {
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
        my_decision: if authored { "approved" } else { "not_reviewed" }.to_owned(),
        author_avatar_url: None,
        latest_commit: Some(format!("mock-commit-{id}")),
        review_summary: PullRequestReviewSummaryDto::default(),
        needs_action: !authored,
        activity,
        review: None,
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
    let mode = DevMockMode::new(true);
    let mut monitors = mode.monitors()?;
    let now = now_iso();
    let mut high_priority_issues = vec![
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
    for issue in &mut high_priority_issues {
        issue.priority = "High".to_owned();
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
        last_success_at: Some(now),
        next_check_at: None,
        current_issue_count: high_priority_issues.len() as i64,
        changes_after_last_check: 0,
        max_tracked_issues: 100,
        exceeds_limit: false,
        last_error: None,
        issues: high_priority_issues,
    });
    for monitor in monitors {
        persist_mock_task_tracker_snapshot(pool, &monitor).await?;
    }
    Ok(())
}

pub async fn seed_mock_settings(pool: &SqlitePool) -> Result<(), String> {
    let mode = DevMockMode::new(true);
    for fixture in mode.mock_integrations()? {
        let integration = Integration {
            id: fixture.id,
            kind: fixture.kind,
            base_url: fixture.base_url,
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
    repositories::upsert_setting(
        pool,
        "dev.mock.settings",
        r#"{"schemaVersion":1,"dataSource":"synthetic","integrationIds":["mock-jira","mock-bitbucket","mock-confluence"]}"#,
        1,
    )
    .await
    .map_err(|_| "failed to seed mock scenario settings".to_owned())?;
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
        mock_mode_requested, persist_mock_task_tracker_snapshot, seed_mock_settings, DevMockMode,
    };
    use crate::infrastructure::db::{open_database, repositories};

    #[tokio::test]
    async fn startup_seed_writes_mock_integrations_to_the_database() {
        let temp_dir = tempfile::tempdir().expect("temporary mock app data");
        let pool = open_database(&temp_dir.path().join("mework-mock.sqlite"))
            .await
            .expect("mock database migrations");

        seed_mock_settings(&pool).await.expect("seed mock settings");

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
        assert!(integrations
            .iter()
            .all(|integration| integration.base_url.ends_with(".example.invalid")));
        let settings = repositories::get_setting(&pool, "dev.mock.settings")
            .await
            .expect("read mock settings");
        assert!(settings.unwrap().contains("synthetic"));

        let monitors = crate::application::task_tracker::list_monitors(&pool)
            .await
            .expect("list seeded Task Tracker monitors");
        assert_eq!(monitors.len(), 2);
        assert!(monitors.iter().all(|monitor| monitor.enabled));
        assert!(monitors
            .iter()
            .all(|monitor| !monitor.issues.is_empty() && monitor.jql.contains("project = MOCK")));
        assert!(monitors
            .iter()
            .flat_map(|monitor| &monitor.issues)
            .all(|issue| issue.issue_url.starts_with("https://jira.example.invalid/")));
    }

    #[tokio::test]
    async fn overlay_task_mutations_are_visible_through_the_task_tracker_database_read() {
        let temp_dir = tempfile::tempdir().expect("temporary mock app data");
        let pool = open_database(&temp_dir.path().join("mework-mock.sqlite"))
            .await
            .expect("mock database migrations");
        seed_mock_settings(&pool).await.expect("seed mock settings");
        let mode = DevMockMode::new(true);

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
            .any(|issue| issue.key == "MOCK-104"
                && issue.summary == "MOCK DATA · Added from overlay"));
        assert_eq!(monitors.len(), 2, "other seeded monitors remain intact");
    }

    #[test]
    fn mock_provider_data_covers_integrations_managed_projects_daily_and_confluence() {
        let mode = DevMockMode::new(true);
        let integrations = mode.mock_integrations().unwrap();
        assert_eq!(integrations.len(), 3);
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
        let planning_projects = mode.mock_planning_projects().unwrap();
        assert_eq!(planning_projects[0].id, projects[0].id);
        let daily = mode.mock_daily_workspace(&projects[0].id, None).unwrap();
        assert_eq!(daily.subtasks.len(), 3);
        assert!(daily
            .subtasks
            .iter()
            .all(|task| task.url.starts_with("https://jira.example.invalid/")));
        let search = mode
            .mock_confluence_search(crate::application::confluence::ConfluenceSearchRequest {
                integration_id: "mock-confluence".to_owned(),
                query: "example".to_owned(),
                space_key: None,
                limit: 20,
            })
            .unwrap();
        assert_eq!(search.results.len(), 2);
        assert!(search
            .results
            .iter()
            .all(|result| result.title.starts_with("MOCK DATA")));
    }

    #[test]
    fn mock_task_tracker_jql_preview_uses_only_synthetic_issues() {
        let mode = DevMockMode::new(true);
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
        let mode = DevMockMode::new(true);
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
        let mode = DevMockMode::new(true);
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
        assert_eq!(mode.unread_counts().unwrap().0, 2);
    }

    #[test]
    fn release_guard_rejects_mock_mutations() {
        let mode = DevMockMode::new(false);
        assert!(mode.snapshot().is_err());
        assert!(mode.add_task("synthetic task").is_err());
    }
}
