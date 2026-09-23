use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{Duration as StdDuration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use tauri::{AppHandle, Emitter, Runtime};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime, Weekday};
use uuid::Uuid;

use crate::{
    application::general,
    domain::models::{Integration, IntegrationKind},
    infrastructure::{
        credentials::keyring::{
            CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
        },
        db::repositories,
        integrations::jira::models::JiraIssue,
    },
    os::notifications::{NativeNotificationAdapter, NotificationAdapter},
};

const KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};
const JIRA_PAGE_SIZE: u64 = 100;
const JQL_VALIDATION_LIMIT: usize = 10;
const DEFAULT_MAX_TRACKED_ISSUES: i64 = 100;
const MAX_ALLOWED_TRACKED_ISSUES: i64 = 10_000;
const TRACKED_EVENTS: [TaskTrackerEventKind; 4] = [
    TaskTrackerEventKind::NewIssues,
    TaskTrackerEventKind::RemovedIssues,
    TaskTrackerEventKind::StatusChanges,
    TaskTrackerEventKind::NewComments,
];

#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskTrackerEventKind {
    NewIssues,
    RemovedIssues,
    StatusChanges,
    NewComments,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskTrackerScheduleKind {
    Period,
    Cron,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskTrackerChangeKind {
    New,
    Removed,
    Status,
    Comment,
}

impl TaskTrackerChangeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Removed => "removed",
            Self::Status => "status",
            Self::Comment => "comment",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::New => "New issue",
            Self::Removed => "Issue removed",
            Self::Status => "Status changed",
            Self::Comment => "New comment",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerMonitorRequest {
    pub id: Option<String>,
    pub name: String,
    pub jql: String,
    pub schedule_kind: TaskTrackerScheduleKind,
    pub schedule_value: String,
    #[serde(default)]
    pub tracked_events: Vec<TaskTrackerEventKind>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_max_tracked_issues")]
    pub max_tracked_issues: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerMonitorExportRequest {
    pub name: String,
    pub jql: String,
    pub schedule_kind: TaskTrackerScheduleKind,
    pub schedule_value: String,
    pub tracked_events: Vec<TaskTrackerEventKind>,
    pub enabled: bool,
    pub max_tracked_issues: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerJqlRequest {
    pub jql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerChangeDto {
    pub kind: TaskTrackerChangeKind,
    pub description: String,
    pub detected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerIssueDto {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub priority: String,
    pub assignee: Option<String>,
    pub updated: Option<String>,
    pub issue_url: String,
    pub last_change: Option<TaskTrackerChangeDto>,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerMonitorDto {
    pub id: String,
    pub name: String,
    pub jql: String,
    pub schedule_kind: TaskTrackerScheduleKind,
    pub schedule_value: String,
    pub tracked_events: Vec<TaskTrackerEventKind>,
    pub enabled: bool,
    pub last_success_at: Option<String>,
    pub next_check_at: Option<i64>,
    pub current_issue_count: i64,
    pub changes_after_last_check: i64,
    pub max_tracked_issues: i64,
    pub exceeds_limit: bool,
    pub last_error: Option<String>,
    pub issues: Vec<TaskTrackerIssueDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTrackerJqlPreviewDto {
    pub issue_count: i64,
    pub truncated: bool,
    pub issues: Vec<TaskTrackerIssueDto>,
}

#[derive(Debug, Clone)]
struct MonitorRecord {
    id: String,
    integration_id: String,
    name: String,
    jql: String,
    schedule_kind: TaskTrackerScheduleKind,
    schedule_value: String,
    tracked_events: Vec<TaskTrackerEventKind>,
    enabled: bool,
    last_success_at: Option<String>,
    next_check_at_ms: Option<i64>,
    current_issue_count: i64,
    changes_after_last_check: i64,
    max_tracked_issues: i64,
    exceeds_limit: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
struct IssueState {
    key: String,
    summary: String,
    status: String,
    priority: String,
    assignee: Option<String>,
    updated: Option<String>,
    comment_count: i64,
    issue_url: String,
    present: bool,
    last_change: Option<TaskTrackerChangeDto>,
}

#[derive(Debug, Clone)]
struct JiraIssueSnapshot {
    issue_id: String,
    key: String,
    summary: String,
    status: String,
    priority: String,
    assignee: Option<String>,
    updated: Option<String>,
    comment_count: i64,
    issue_url: String,
}

#[derive(Debug, Clone)]
struct DetectedChange {
    key: String,
    summary: String,
    issue_url: String,
    kind: TaskTrackerChangeKind,
    description: String,
}

#[derive(Debug, Deserialize)]
struct JiraSearchPage {
    #[serde(rename = "startAt")]
    start_at: u64,
    total: u64,
    issues: Vec<JiraIssue>,
}

fn default_enabled() -> bool {
    true
}

fn default_max_tracked_issues() -> i64 {
    DEFAULT_MAX_TRACKED_ISSUES
}

fn validate_max_tracked_issues(max_tracked_issues: i64) -> Result<(), String> {
    if !(1..=MAX_ALLOWED_TRACKED_ISSUES).contains(&max_tracked_issues) {
        return Err(format!(
            "Maximum tracked issues must be between 1 and {MAX_ALLOWED_TRACKED_ISSUES}"
        ));
    }
    Ok(())
}

fn exceeds_issue_limit(observed_count: i64, max_tracked_issues: i64, truncated: bool) -> bool {
    truncated || observed_count > max_tracked_issues
}

fn next_query_page_size(limit: Option<usize>, fetched_count: usize) -> u64 {
    limit
        .map(|limit| {
            limit
                .saturating_sub(fetched_count)
                .min(JIRA_PAGE_SIZE as usize) as u64
        })
        .unwrap_or(JIRA_PAGE_SIZE)
}

fn should_compare_snapshot(has_previous_success: bool, exceeded_limit: bool) -> bool {
    has_previous_success && !exceeded_limit
}

pub async fn list_monitors(pool: &SqlitePool) -> Result<Vec<TaskTrackerMonitorDto>, String> {
    let rows = sqlx::query(
        "SELECT id, integration_id, name, jql, schedule_kind, schedule_value,
                tracked_events_json, enabled, max_tracked_issues, exceeds_limit, last_success_at, next_check_at_ms,
                current_issue_count, changes_after_last_check, last_error
         FROM task_monitors ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| "Task tracker monitors could not be loaded".to_owned())?;

    let mut monitors = Vec::with_capacity(rows.len());
    for row in rows {
        let record = row_to_monitor(row)?;
        monitors.push(to_monitor_dto(pool, &record).await?);
    }
    Ok(monitors)
}

pub async fn save_monitor(
    pool: &SqlitePool,
    request: TaskTrackerMonitorRequest,
) -> Result<TaskTrackerMonitorDto, String> {
    let name = required_text(&request.name, "Monitor name", 120)?;
    let jql = required_text(&request.jql, "JQL", 10_000)?;
    let tracked_events = normalize_events(request.tracked_events);
    validate_schedule(request.schedule_kind, &request.schedule_value)?;
    validate_max_tracked_issues(request.max_tracked_issues)?;
    let integration = jira_integration(pool, None).await?;
    let now = now_iso();
    let effective_enabled = request.enabled;
    let monitor_id = request.id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let existing = sqlx::query(
        "SELECT id, integration_id, name, jql, schedule_kind, schedule_value,
                tracked_events_json, enabled, max_tracked_issues, exceeds_limit, last_success_at, next_check_at_ms,
                current_issue_count, changes_after_last_check, last_error
         FROM task_monitors WHERE id = ?",
    )
    .bind(&monitor_id)
    .fetch_optional(pool)
    .await
    .map_err(|_| "Task tracker monitor could not be loaded".to_owned())?
    .map(row_to_monitor)
    .transpose()?;
    let reset_snapshot = existing.as_ref().is_some_and(|previous| {
        previous.jql != jql
            || previous.integration_id != integration.id
            || previous.max_tracked_issues != request.max_tracked_issues
    });
    let needs_baseline = existing
        .as_ref()
        .is_none_or(|previous| previous.last_success_at.is_none() || !previous.enabled)
        || reset_snapshot;
    let next_check_at_ms = if effective_enabled {
        Some(if needs_baseline {
            now_ms()
        } else {
            next_check_at(request.schedule_kind, &request.schedule_value, now_ms())?
        })
    } else {
        None
    };

    if existing.is_some() {
        if reset_snapshot {
            sqlx::query("DELETE FROM task_monitor_issues WHERE monitor_id = ?")
                .bind(&monitor_id)
                .execute(pool)
                .await
                .map_err(|_| "Task tracker snapshot could not be reset".to_owned())?;
        }
        sqlx::query(
            "UPDATE task_monitors
             SET integration_id = ?, name = ?, jql = ?, schedule_kind = ?, schedule_value = ?,
                 tracked_events_json = ?, enabled = ?, max_tracked_issues = ?, next_check_at_ms = ?,
                 last_error = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(&integration.id)
        .bind(&name)
        .bind(&jql)
        .bind(schedule_kind_str(request.schedule_kind))
        .bind(&request.schedule_value)
        .bind(
            serde_json::to_string(&tracked_events)
                .map_err(|_| "Monitor events are invalid".to_owned())?,
        )
        .bind(effective_enabled)
        .bind(request.max_tracked_issues)
        .bind(next_check_at_ms)
        .bind(&now)
        .bind(&monitor_id)
        .execute(pool)
        .await
        .map_err(|_| "Task tracker monitor could not be saved".to_owned())?;
        if reset_snapshot {
            sqlx::query(
                "UPDATE task_monitors
                 SET last_success_at = NULL, current_issue_count = 0,
                     changes_after_last_check = 0, exceeds_limit = 0
                 WHERE id = ?",
            )
            .bind(&monitor_id)
            .execute(pool)
            .await
            .map_err(|_| "Task tracker snapshot could not be reset".to_owned())?;
        }
    } else {
        sqlx::query(
            "INSERT INTO task_monitors
                (id, integration_id, name, jql, schedule_kind, schedule_value,
                 tracked_events_json, enabled, max_tracked_issues, next_check_at_ms, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&monitor_id)
        .bind(&integration.id)
        .bind(&name)
        .bind(&jql)
        .bind(schedule_kind_str(request.schedule_kind))
        .bind(&request.schedule_value)
        .bind(
            serde_json::to_string(&tracked_events)
                .map_err(|_| "Monitor events are invalid".to_owned())?,
        )
        .bind(effective_enabled)
        .bind(request.max_tracked_issues)
        .bind(next_check_at_ms)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|_| "Task tracker monitor could not be saved".to_owned())?;
    }

    let record = load_monitor(pool, &monitor_id).await?;
    to_monitor_dto(pool, &record).await
}

pub fn save_monitor_export(
    file_path: &str,
    request: TaskTrackerMonitorExportRequest,
) -> Result<(), String> {
    let path = Path::new(file_path);
    let is_json = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"));
    if !path.is_absolute() || !is_json {
        return Err("Choose an absolute path with a .json extension".to_owned());
    }

    let name = required_text(&request.name, "Monitor name", 120)?;
    let jql = required_text(&request.jql, "JQL", 10_000)?;
    required_text(&request.schedule_value, "Schedule", 200)?;
    validate_schedule(request.schedule_kind, &request.schedule_value)?;
    validate_max_tracked_issues(request.max_tracked_issues)?;

    let document = serde_json::json!({
        "format": "mework-task-tracker-monitor",
        "version": 1,
        "monitor": TaskTrackerMonitorExportRequest {
            name,
            jql,
            schedule_kind: request.schedule_kind,
            schedule_value: request.schedule_value,
            tracked_events: request.tracked_events,
            enabled: request.enabled,
            max_tracked_issues: request.max_tracked_issues,
        },
    });
    let contents = serde_json::to_vec_pretty(&document)
        .map_err(|_| "Task tracker monitor export could not be serialized".to_owned())?;
    std::fs::write(path, contents)
        .map_err(|_| "Task tracker monitor export could not be saved".to_owned())
}

pub async fn delete_monitor(pool: &SqlitePool, id: &str) -> Result<bool, String> {
    let result = sqlx::query("DELETE FROM task_monitors WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|_| "Task tracker monitor could not be deleted".to_owned())?;
    Ok(result.rows_affected() == 1)
}

pub async fn set_monitor_enabled(
    pool: &SqlitePool,
    id: &str,
    enabled: bool,
) -> Result<TaskTrackerMonitorDto, String> {
    let record = load_monitor(pool, id).await?;
    let next = if enabled {
        Some(next_check_at(
            record.schedule_kind,
            &record.schedule_value,
            now_ms(),
        )?)
    } else {
        None
    };
    sqlx::query(
        "UPDATE task_monitors
         SET enabled = ?, next_check_at_ms = ?, last_error = NULL,
             updated_at = ? WHERE id = ?",
    )
    .bind(enabled)
    .bind(next)
    .bind(now_iso())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|_| "Task tracker monitor could not be updated".to_owned())?;
    let record = load_monitor(pool, id).await?;
    to_monitor_dto(pool, &record).await
}

pub async fn validate_jql(
    pool: &SqlitePool,
    request: TaskTrackerJqlRequest,
) -> Result<TaskTrackerJqlPreviewDto, String> {
    let jql = required_text(&request.jql, "JQL", 10_000)?;
    let integration = jira_integration(pool, None).await?;
    let (issues, truncated) =
        fetch_issues_with_limit(&integration, &jql, Some(JQL_VALIDATION_LIMIT)).await?;
    let preview = issues
        .iter()
        .take(5)
        .map(|issue| issue_to_dto(issue, None))
        .collect();
    Ok(TaskTrackerJqlPreviewDto {
        issue_count: issues.len() as i64,
        truncated,
        issues: preview,
    })
}

pub async fn check_now<R: Runtime>(
    pool: &SqlitePool,
    app: &AppHandle<R>,
    id: &str,
) -> Result<TaskTrackerMonitorDto, String> {
    let adapter = NativeNotificationAdapter::new(app.clone());
    let result = poll_monitor(pool, id, Some(&adapter)).await;
    let monitors = list_monitors(pool).await?;
    let _ = app.emit("task_tracker_updated", &monitors);
    result
}

pub async fn poll_due_monitors<R: Runtime>(
    pool: &SqlitePool,
    app: &AppHandle<R>,
) -> Result<(), String> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT id FROM task_monitors
         WHERE enabled = 1 AND next_check_at_ms IS NOT NULL AND next_check_at_ms <= ?
         ORDER BY next_check_at_ms ASC",
    )
    .bind(now_ms())
    .fetch_all(pool)
    .await
    .map_err(|_| "Task tracker schedule could not be loaded".to_owned())?;

    if ids.is_empty() {
        return Ok(());
    }
    let adapter = NativeNotificationAdapter::new(app.clone());
    for id in ids {
        let _ = poll_monitor(pool, &id, Some(&adapter)).await;
    }
    let monitors = list_monitors(pool).await?;
    let _ = app.emit("task_tracker_updated", monitors);
    Ok(())
}

async fn poll_monitor<R: Runtime>(
    pool: &SqlitePool,
    id: &str,
    adapter: Option<&NativeNotificationAdapter<R>>,
) -> Result<TaskTrackerMonitorDto, String> {
    let monitor = load_monitor(pool, id).await?;
    let integration = match repositories::get_integration(pool, &monitor.integration_id).await {
        Ok(value) => value,
        Err(_) => {
            let error = "Jira integration is unavailable".to_owned();
            record_failure(pool, &monitor, &error).await?;
            return Err(error);
        }
    };
    let (issues, truncated) = match fetch_issues_with_limit(
        &integration,
        &monitor.jql,
        Some(monitor.max_tracked_issues.saturating_add(1) as usize),
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            record_failure(pool, &monitor, &error).await?;
            return Err(error);
        }
    };
    if exceeds_issue_limit(issues.len() as i64, monitor.max_tracked_issues, truncated) {
        let now = now_iso();
        let next_check = if monitor.enabled {
            Some(next_check_at(
                monitor.schedule_kind,
                &monitor.schedule_value,
                now_ms(),
            )?)
        } else {
            None
        };
        sqlx::query(
            "UPDATE task_monitors
             SET last_success_at = ?, next_check_at_ms = ?, current_issue_count = ?,
                 changes_after_last_check = 0, exceeds_limit = 1, last_error = NULL, updated_at = ?
             WHERE id = ?",
        )
        .bind(&now)
        .bind(next_check)
        .bind(issues.len() as i64)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|_| "Task tracker monitor could not be updated".to_owned())?;
        let updated = load_monitor(pool, id).await?;
        return to_monitor_dto(pool, &updated).await;
    }
    let previous = load_issue_states(pool, id).await?;
    let baseline_exists =
        should_compare_snapshot(monitor.last_success_at.is_some(), monitor.exceeds_limit);
    let now = now_iso();
    let current_by_key: HashMap<String, JiraIssueSnapshot> = issues
        .iter()
        .cloned()
        .map(|issue| (issue.key.clone(), issue))
        .collect();
    let mut changes = Vec::new();

    for issue in &issues {
        let previous_issue = previous.get(&issue.key);
        if baseline_exists {
            if previous_issue.is_none_or(|item| !item.present)
                && monitor
                    .tracked_events
                    .contains(&TaskTrackerEventKind::NewIssues)
            {
                changes.push(DetectedChange {
                    key: issue.key.clone(),
                    summary: issue.summary.clone(),
                    issue_url: issue.issue_url.clone(),
                    kind: TaskTrackerChangeKind::New,
                    description: "Issue appeared in the JQL result.".to_owned(),
                });
            } else if let Some(previous_issue) = previous_issue {
                if previous_issue.present
                    && previous_issue.status != issue.status
                    && monitor
                        .tracked_events
                        .contains(&TaskTrackerEventKind::StatusChanges)
                {
                    changes.push(DetectedChange {
                        key: issue.key.clone(),
                        summary: issue.summary.clone(),
                        issue_url: issue.issue_url.clone(),
                        kind: TaskTrackerChangeKind::Status,
                        description: format!(
                            "Status changed: {} → {}.",
                            previous_issue.status, issue.status
                        ),
                    });
                }
                if previous_issue.present
                    && issue.comment_count > previous_issue.comment_count
                    && monitor
                        .tracked_events
                        .contains(&TaskTrackerEventKind::NewComments)
                {
                    changes.push(DetectedChange {
                        key: issue.key.clone(),
                        summary: issue.summary.clone(),
                        issue_url: issue.issue_url.clone(),
                        kind: TaskTrackerChangeKind::Comment,
                        description: "A new comment was detected.".to_owned(),
                    });
                }
            }
        }
    }

    if baseline_exists
        && monitor
            .tracked_events
            .contains(&TaskTrackerEventKind::RemovedIssues)
    {
        for previous_issue in previous.values().filter(|item| item.present) {
            if !current_by_key.contains_key(&previous_issue.key) {
                changes.push(DetectedChange {
                    key: previous_issue.key.clone(),
                    summary: previous_issue.summary.clone(),
                    issue_url: previous_issue.issue_url.clone(),
                    kind: TaskTrackerChangeKind::Removed,
                    description: "Issue left the JQL result.".to_owned(),
                });
            }
        }
    }

    let next_check = if monitor.enabled {
        Some(next_check_at(
            monitor.schedule_kind,
            &monitor.schedule_value,
            now_ms(),
        )?)
    } else {
        None
    };
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "Task tracker snapshot could not be saved".to_owned())?;

    for issue in &issues {
        let change = changes.iter().rev().find(|change| change.key == issue.key);
        sqlx::query(
            "INSERT INTO task_monitor_issues
                (monitor_id, issue_id, issue_key, summary, status, priority, assignee, updated,
                 comment_count, issue_url, present, last_change_type, last_change_description,
                 last_changed_at, observed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(monitor_id, issue_key) DO UPDATE SET
                issue_id = excluded.issue_id,
                summary = excluded.summary,
                status = excluded.status,
                priority = excluded.priority,
                assignee = excluded.assignee,
                updated = excluded.updated,
                comment_count = excluded.comment_count,
                issue_url = excluded.issue_url,
                present = 1,
                last_change_type = COALESCE(excluded.last_change_type, task_monitor_issues.last_change_type),
                last_change_description = COALESCE(excluded.last_change_description, task_monitor_issues.last_change_description),
                last_changed_at = COALESCE(excluded.last_changed_at, task_monitor_issues.last_changed_at),
                observed_at = excluded.observed_at",
        )
        .bind(id)
        .bind(&issue.issue_id)
        .bind(&issue.key)
        .bind(&issue.summary)
        .bind(&issue.status)
        .bind(&issue.priority)
        .bind(&issue.assignee)
        .bind(&issue.updated)
        .bind(issue.comment_count)
        .bind(&issue.issue_url)
        .bind(change.map(|value| value.kind.as_str()))
        .bind(change.map(|value| value.description.as_str()))
        .bind(change.map(|_| now.as_str()))
        .bind(&now)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "Task tracker snapshot could not be saved".to_owned())?;
    }

    for previous_issue in previous.values().filter(|item| item.present) {
        if current_by_key.contains_key(&previous_issue.key) {
            continue;
        }
        let change = changes
            .iter()
            .rev()
            .find(|value| value.key == previous_issue.key);
        sqlx::query(
            "UPDATE task_monitor_issues
             SET present = 0,
                 last_change_type = COALESCE(?, last_change_type),
                 last_change_description = COALESCE(?, last_change_description),
                 last_changed_at = COALESCE(?, last_changed_at),
                 observed_at = ?
             WHERE monitor_id = ? AND issue_key = ?",
        )
        .bind(change.map(|value| value.kind.as_str()))
        .bind(change.map(|value| value.description.as_str()))
        .bind(change.map(|_| now.as_str()))
        .bind(&now)
        .bind(id)
        .bind(&previous_issue.key)
        .execute(&mut *transaction)
        .await
        .map_err(|_| "Task tracker snapshot could not be saved".to_owned())?;
    }

    sqlx::query(
        "UPDATE task_monitors
         SET last_success_at = ?, next_check_at_ms = ?, current_issue_count = ?,
             changes_after_last_check = ?, exceeds_limit = 0, last_error = NULL, updated_at = ?
         WHERE id = ?",
    )
    .bind(&now)
    .bind(next_check)
    .bind(issues.len() as i64)
    .bind(changes.len() as i64)
    .bind(&now)
    .bind(id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "Task tracker monitor could not be updated".to_owned())?;
    transaction
        .commit()
        .await
        .map_err(|_| "Task tracker snapshot could not be committed".to_owned())?;

    if adapter.is_some()
        && general::task_tracker_notifications_enabled(pool)
            .await
            .unwrap_or(false)
    {
        if let Some(adapter) = adapter {
            for change in &changes {
                let title = format!("{} · {}", change.key, change.kind.label());
                let body = format!("{}\n{}", change.summary, change.description);
                if let Err(error) =
                    adapter.notify_with_url(&title, &body, &change.key, &change.issue_url)
                {
                    eprintln!("Task tracker notification delivery failed: {error}");
                }
            }
        }
    }

    let updated = load_monitor(pool, id).await?;
    to_monitor_dto(pool, &updated).await
}

async fn record_failure(
    pool: &SqlitePool,
    monitor: &MonitorRecord,
    error: &str,
) -> Result<(), String> {
    let next_check = if monitor.enabled {
        Some(next_check_at(
            monitor.schedule_kind,
            &monitor.schedule_value,
            now_ms(),
        )?)
    } else {
        None
    };
    sqlx::query(
        "UPDATE task_monitors SET next_check_at_ms = ?, last_error = ?, updated_at = ? WHERE id = ?",
    )
    .bind(next_check)
    .bind(safe_error(error))
    .bind(now_iso())
    .bind(&monitor.id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|_| "Task tracker monitor error could not be saved".to_owned())
}

async fn fetch_issues_with_limit(
    integration: &Integration,
    jql: &str,
    limit: Option<usize>,
) -> Result<(Vec<JiraIssueSnapshot>, bool), String> {
    let store = OsKeyring::new(KEYRING_SERVICE);
    let secret = store
        .load(&integration.credential_ref)
        .map_err(|_| "Jira credentials are unavailable".to_owned())?;
    if secret.trim().is_empty() {
        return Err("Jira credentials are unavailable".to_owned());
    }
    let mut builder = Client::builder().timeout(StdDuration::from_secs(30));
    if integration.allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let client = builder
        .build()
        .map_err(|_| "Jira transport is unavailable".to_owned())?;
    let endpoint = jira_endpoint(&integration.base_url, "rest/api/2/search")?;
    let mut start_at = 0_u64;
    let mut result = Vec::new();
    loop {
        // Request only the number of issues still needed to decide the N+1 limit.
        let page_size = next_query_page_size(limit, result.len());
        if page_size == 0 {
            break;
        }
        let response = jira_authenticate(
            client.get(endpoint.clone()),
            &integration.account_key,
            &secret,
        )
        .query(&[
            ("jql", jql),
            ("startAt", &start_at.to_string()),
            ("maxResults", &page_size.to_string()),
            ("fields", "summary,status,priority,assignee,updated,comment"),
        ])
        .send()
        .await
        .map_err(|_| "Jira request failed".to_owned())?;
        if !response.status().is_success() {
            return Err(format!(
                "Jira request failed ({})",
                response.status().as_u16()
            ));
        }
        let page: JiraSearchPage = response
            .json()
            .await
            .map_err(|_| "Jira returned an invalid issue response".to_owned())?;
        let returned = page.issues.len() as u64;
        result.extend(
            page.issues
                .into_iter()
                .map(|issue| issue_snapshot(integration, issue)),
        );
        start_at = page.start_at.saturating_add(returned);
        if let Some(limit) = limit {
            if result.len() >= limit {
                return Ok((
                    result.into_iter().take(limit).collect(),
                    start_at < page.total,
                ));
            }
        }
        if returned == 0 || start_at >= page.total {
            break;
        }
    }
    Ok((result, false))
}

fn issue_snapshot(integration: &Integration, issue: JiraIssue) -> JiraIssueSnapshot {
    let fields = issue.fields;
    JiraIssueSnapshot {
        issue_id: issue.id,
        key: issue.key.clone(),
        summary: field_string(&fields, "summary").unwrap_or_default(),
        status: nested_name(&fields, "status"),
        priority: nested_name(&fields, "priority"),
        assignee: nested_name_optional(&fields, "assignee"),
        updated: field_string(&fields, "updated"),
        comment_count: fields
            .get("comment")
            .and_then(|value| value.get("total"))
            .and_then(Value::as_i64)
            .unwrap_or(0),
        issue_url: jira_issue_url(&integration.base_url, &issue.key),
    }
}

fn issue_to_dto(
    issue: &JiraIssueSnapshot,
    last_change: Option<TaskTrackerChangeDto>,
) -> TaskTrackerIssueDto {
    let changed = last_change.is_some();
    TaskTrackerIssueDto {
        key: issue.key.clone(),
        summary: issue.summary.clone(),
        status: issue.status.clone(),
        priority: issue.priority.clone(),
        assignee: issue.assignee.clone(),
        updated: issue.updated.clone(),
        issue_url: issue.issue_url.clone(),
        last_change,
        changed,
    }
}

async fn to_monitor_dto(
    pool: &SqlitePool,
    record: &MonitorRecord,
) -> Result<TaskTrackerMonitorDto, String> {
    let issues = load_issue_states(pool, &record.id)
        .await?
        .into_values()
        .filter_map(|issue| {
            let changed = issue.last_change.as_ref().is_some_and(|change| {
                record
                    .last_success_at
                    .as_ref()
                    .is_some_and(|last_success| last_success == &change.detected_at)
            });
            if !issue.present && !changed {
                return None;
            }
            Some(TaskTrackerIssueDto {
                key: issue.key,
                summary: issue.summary,
                status: issue.status,
                priority: issue.priority,
                assignee: issue.assignee,
                updated: issue.updated,
                issue_url: issue.issue_url,
                changed,
                last_change: issue.last_change,
            })
        })
        .collect();
    Ok(TaskTrackerMonitorDto {
        id: record.id.clone(),
        name: record.name.clone(),
        jql: record.jql.clone(),
        schedule_kind: record.schedule_kind,
        schedule_value: record.schedule_value.clone(),
        tracked_events: record.tracked_events.clone(),
        enabled: record.enabled,
        last_success_at: record.last_success_at.clone(),
        next_check_at: record.next_check_at_ms,
        current_issue_count: record.current_issue_count,
        changes_after_last_check: record.changes_after_last_check,
        max_tracked_issues: record.max_tracked_issues,
        exceeds_limit: record.exceeds_limit,
        last_error: record.last_error.clone(),
        issues,
    })
}

async fn load_monitor(pool: &SqlitePool, id: &str) -> Result<MonitorRecord, String> {
    sqlx::query(
        "SELECT id, integration_id, name, jql, schedule_kind, schedule_value,
                tracked_events_json, enabled, max_tracked_issues, exceeds_limit, last_success_at, next_check_at_ms,
                current_issue_count, changes_after_last_check, last_error
         FROM task_monitors WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|_| "Task tracker monitor was not found".to_owned())
    .and_then(row_to_monitor)
}

fn row_to_monitor(row: SqliteRow) -> Result<MonitorRecord, String> {
    let schedule_kind = match row
        .try_get::<String, _>("schedule_kind")
        .map_err(|_| "Task tracker monitor data is invalid".to_owned())?
        .as_str()
    {
        "period" => TaskTrackerScheduleKind::Period,
        "cron" => TaskTrackerScheduleKind::Cron,
        _ => return Err("Task tracker schedule is invalid".to_owned()),
    };
    let raw_events: String = row
        .try_get("tracked_events_json")
        .map_err(|_| "Task tracker events are invalid".to_owned())?;
    let tracked_events = serde_json::from_str::<Vec<TaskTrackerEventKind>>(&raw_events)
        .map(normalize_events)
        .unwrap_or_else(|_| TRACKED_EVENTS.to_vec());
    Ok(MonitorRecord {
        id: row
            .try_get("id")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        integration_id: row
            .try_get("integration_id")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        name: row
            .try_get("name")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        jql: row
            .try_get("jql")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        schedule_kind,
        schedule_value: row
            .try_get("schedule_value")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        tracked_events,
        enabled: row
            .try_get::<i64, _>("enabled")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?
            != 0,
        max_tracked_issues: row
            .try_get("max_tracked_issues")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        exceeds_limit: row
            .try_get::<i64, _>("exceeds_limit")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?
            != 0,
        last_success_at: row
            .try_get("last_success_at")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        next_check_at_ms: row
            .try_get("next_check_at_ms")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        current_issue_count: row
            .try_get("current_issue_count")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        changes_after_last_check: row
            .try_get("changes_after_last_check")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
        last_error: row
            .try_get("last_error")
            .map_err(|_| "Task tracker monitor data is invalid".to_owned())?,
    })
}

async fn load_issue_states(
    pool: &SqlitePool,
    monitor_id: &str,
) -> Result<HashMap<String, IssueState>, String> {
    let rows = sqlx::query(
        "SELECT issue_id, issue_key, summary, status, priority, assignee, updated, comment_count,
                issue_url, present, last_change_type, last_change_description, last_changed_at
         FROM task_monitor_issues WHERE monitor_id = ?",
    )
    .bind(monitor_id)
    .fetch_all(pool)
    .await
    .map_err(|_| "Task tracker snapshot could not be loaded".to_owned())?;
    let mut issues = HashMap::new();
    for row in rows {
        let kind = row
            .try_get::<Option<String>, _>("last_change_type")
            .map_err(|_| "Task tracker snapshot is invalid".to_owned())?
            .and_then(|value| parse_change_kind(&value));
        let description: Option<String> = row
            .try_get("last_change_description")
            .map_err(|_| "Task tracker snapshot is invalid".to_owned())?;
        let detected_at: Option<String> = row
            .try_get("last_changed_at")
            .map_err(|_| "Task tracker snapshot is invalid".to_owned())?;
        let last_change = match (kind, description, detected_at) {
            (Some(kind), Some(description), Some(detected_at)) => Some(TaskTrackerChangeDto {
                kind,
                description,
                detected_at,
            }),
            _ => None,
        };
        let issue = IssueState {
            key: row
                .try_get("issue_key")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            summary: row
                .try_get("summary")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            status: row
                .try_get("status")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            priority: row
                .try_get("priority")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            assignee: row
                .try_get("assignee")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            updated: row
                .try_get("updated")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            comment_count: row
                .try_get("comment_count")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            issue_url: row
                .try_get("issue_url")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?,
            present: row
                .try_get::<i64, _>("present")
                .map_err(|_| "Task tracker snapshot is invalid".to_owned())?
                != 0,
            last_change,
        };
        issues.insert(issue.key.clone(), issue);
    }
    Ok(issues)
}

async fn jira_integration(pool: &SqlitePool, id: Option<&str>) -> Result<Integration, String> {
    if let Some(id) = id {
        let integration = repositories::get_integration(pool, id)
            .await
            .map_err(|_| "Jira integration is unavailable".to_owned())?;
        if integration.kind == IntegrationKind::Jira && integration.enabled {
            return Ok(integration);
        }
        return Err("Jira integration is unavailable".to_owned());
    }
    repositories::list_integrations(pool)
        .await
        .map_err(|_| "Jira integration is unavailable".to_owned())?
        .into_iter()
        .find(|integration| integration.kind == IntegrationKind::Jira && integration.enabled)
        .ok_or_else(|| "Jira integration is unavailable".to_owned())
}

fn jira_authenticate(request: RequestBuilder, account_key: &str, secret: &str) -> RequestBuilder {
    if account_key.trim().is_empty() {
        request.bearer_auth(secret)
    } else {
        request.basic_auth(account_key, Some(secret))
    }
}

fn jira_endpoint(base_url: &str, path: &str) -> Result<Url, String> {
    let mut base = Url::parse(base_url).map_err(|_| "Jira base URL is invalid".to_owned())?;
    if !base.path().ends_with('/') {
        base.set_path(&format!("{}/", base.path()));
    }
    base.join(path)
        .map_err(|_| "Jira endpoint is invalid".to_owned())
}

fn jira_issue_url(base_url: &str, key: &str) -> String {
    jira_endpoint(base_url, &format!("browse/{key}"))
        .map(|url| url.to_string())
        .unwrap_or_default()
}

fn nested_name(fields: &Value, key: &str) -> String {
    nested_name_optional(fields, key).unwrap_or_default()
}

fn nested_name_optional(fields: &Value, key: &str) -> Option<String> {
    fields
        .get(key)
        .and_then(|value| value.get("displayName").or_else(|| value.get("name")))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn field_string(fields: &Value, key: &str) -> Option<String> {
    fields.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn parse_change_kind(value: &str) -> Option<TaskTrackerChangeKind> {
    match value {
        "new" => Some(TaskTrackerChangeKind::New),
        "removed" => Some(TaskTrackerChangeKind::Removed),
        "status" => Some(TaskTrackerChangeKind::Status),
        "comment" => Some(TaskTrackerChangeKind::Comment),
        _ => None,
    }
}

fn normalize_events(events: Vec<TaskTrackerEventKind>) -> Vec<TaskTrackerEventKind> {
    let set: HashSet<_> = events.into_iter().collect();
    TRACKED_EVENTS
        .iter()
        .copied()
        .filter(|event| set.contains(event))
        .collect()
}

fn schedule_kind_str(kind: TaskTrackerScheduleKind) -> &'static str {
    match kind {
        TaskTrackerScheduleKind::Period => "period",
        TaskTrackerScheduleKind::Cron => "cron",
    }
}

fn validate_schedule(kind: TaskTrackerScheduleKind, value: &str) -> Result<(), String> {
    match kind {
        TaskTrackerScheduleKind::Period => {
            let seconds = value
                .parse::<u64>()
                .map_err(|_| "Period must be a number of seconds".to_owned())?;
            if seconds == 0 || seconds > 31_536_000 {
                return Err("Period must be between 1 and 31536000 seconds".to_owned());
            }
        }
        TaskTrackerScheduleKind::Cron => {
            parse_cron(value)?;
        }
    }
    Ok(())
}

fn next_check_at(kind: TaskTrackerScheduleKind, value: &str, from_ms: i64) -> Result<i64, String> {
    match kind {
        TaskTrackerScheduleKind::Period => {
            let seconds = value
                .parse::<i64>()
                .map_err(|_| "Period must be a number of seconds".to_owned())?;
            Ok(from_ms.saturating_add(seconds.saturating_mul(1000)))
        }
        TaskTrackerScheduleKind::Cron => {
            let cron = parse_cron(value)?;
            let mut date = OffsetDateTime::from_unix_timestamp(from_ms.div_euclid(1000))
                .map_err(|_| "Cron schedule time is invalid".to_owned())?
                .replace_second(0)
                .map_err(|_| "Cron schedule time is invalid".to_owned())?
                .replace_nanosecond(0)
                .map_err(|_| "Cron schedule time is invalid".to_owned())?
                + Duration::minutes(1);
            for _ in 0..(60 * 24 * 366) {
                if cron.matches(date) {
                    return Ok(date.unix_timestamp().saturating_mul(1000));
                }
                date += Duration::minutes(1);
            }
            Err("Cron schedule has no next occurrence".to_owned())
        }
    }
}

#[derive(Debug)]
struct CronFields {
    minutes: HashSet<u32>,
    hours: HashSet<u32>,
    days: HashSet<u32>,
    months: HashSet<u32>,
    weekdays: HashSet<u32>,
}

impl CronFields {
    fn matches(&self, date: OffsetDateTime) -> bool {
        let weekday = match date.weekday() {
            Weekday::Sunday => 0,
            Weekday::Monday => 1,
            Weekday::Tuesday => 2,
            Weekday::Wednesday => 3,
            Weekday::Thursday => 4,
            Weekday::Friday => 5,
            Weekday::Saturday => 6,
        };
        self.minutes.contains(&(date.minute() as u32))
            && self.hours.contains(&(date.hour() as u32))
            && self.days.contains(&(date.day() as u32))
            && self.months.contains(&(date.month() as u32))
            && self.weekdays.contains(&weekday)
    }
}

fn parse_cron(value: &str) -> Result<CronFields, String> {
    let fields: Vec<_> = value.split_whitespace().collect();
    if fields.len() != 5 {
        return Err("Cron must contain five fields".to_owned());
    }
    Ok(CronFields {
        minutes: parse_cron_field(fields[0], 0, 59)?,
        hours: parse_cron_field(fields[1], 0, 23)?,
        days: parse_cron_field(fields[2], 1, 31)?,
        months: parse_cron_field(fields[3], 1, 12)?,
        weekdays: parse_cron_field(fields[4], 0, 6)?,
    })
}

fn parse_cron_field(value: &str, min: u32, max: u32) -> Result<HashSet<u32>, String> {
    let mut result = HashSet::new();
    for part in value.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err("Cron contains an empty field".to_owned());
        }
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (
                range,
                step.parse::<u32>()
                    .map_err(|_| "Cron step is invalid".to_owned())?,
            ),
            None => (part, 1),
        };
        if step == 0 {
            return Err("Cron step must be positive".to_owned());
        }
        let (from, to) = if range == "*" {
            (min, max)
        } else if let Some((from, to)) = range.split_once('-') {
            (
                from.parse::<u32>()
                    .map_err(|_| "Cron range is invalid".to_owned())?,
                to.parse::<u32>()
                    .map_err(|_| "Cron range is invalid".to_owned())?,
            )
        } else {
            let value = range
                .parse::<u32>()
                .map_err(|_| "Cron value is invalid".to_owned())?;
            (value, value)
        };
        if from < min || to > max || from > to {
            return Err("Cron value is outside its allowed range".to_owned());
        }
        let mut current = from;
        while current <= to {
            result.insert(current);
            match current.checked_add(step) {
                Some(next) => current = next,
                None => break,
            }
        }
    }
    if result.is_empty() {
        return Err("Cron field is empty".to_owned());
    }
    Ok(result)
}

fn required_text(value: &str, label: &str, max_chars: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} is too long"));
    }
    Ok(value.to_owned())
}

fn safe_error(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        return "Task tracker polling failed".to_owned();
    }
    value.chars().take(240).collect()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        exceeds_issue_limit, next_check_at, next_query_page_size, parse_cron, save_monitor_export,
        should_compare_snapshot, validate_max_tracked_issues, TaskTrackerMonitorExportRequest,
        TaskTrackerScheduleKind,
    };

    #[test]
    fn resets_change_detection_after_a_monitor_exceeds_its_issue_limit() {
        assert!(!should_compare_snapshot(true, true));
        assert!(should_compare_snapshot(true, false));
    }

    #[test]
    fn detects_task_tracker_issue_limit_overflow() {
        assert!(!exceeds_issue_limit(100, 100, false));
        assert!(exceeds_issue_limit(101, 100, false));
        assert!(exceeds_issue_limit(100, 100, true));
        assert!(validate_max_tracked_issues(100).is_ok());
        assert!(validate_max_tracked_issues(0).is_err());
        assert!(validate_max_tracked_issues(10_001).is_err());
    }

    #[test]
    fn monitor_search_requests_only_the_remaining_issue_count() {
        assert_eq!(next_query_page_size(Some(101), 0), 100);
        assert_eq!(next_query_page_size(Some(101), 100), 1);
        assert_eq!(next_query_page_size(Some(100), 0), 100);
        assert_eq!(next_query_page_size(None, 0), 100);
    }

    #[test]
    fn saves_monitor_export_json_to_the_selected_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("open-tasks.json");
        let request = TaskTrackerMonitorExportRequest {
            name: "Open tasks".to_owned(),
            jql: "project = DEMO".to_owned(),
            schedule_kind: TaskTrackerScheduleKind::Period,
            schedule_value: "300".to_owned(),
            tracked_events: vec![],
            enabled: true,
            max_tracked_issues: 100,
        };

        save_monitor_export(path.to_str().unwrap(), request).unwrap();

        let document: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(document["format"], "mework-task-tracker-monitor");
        assert_eq!(document["version"], 1);
        assert_eq!(document["monitor"]["maxTrackedIssues"], 100);
        assert_eq!(document["monitor"]["jql"], "project = DEMO");
    }

    #[test]
    fn accepts_tasknotify_style_cron() {
        let cron = parse_cron("*/10 * * * *").expect("valid cron");
        assert!(cron.minutes.contains(&0));
        assert!(cron.minutes.contains(&10));
        assert!(!cron.minutes.contains(&11));
    }

    #[test]
    fn computes_period_schedule() {
        assert_eq!(
            next_check_at(TaskTrackerScheduleKind::Period, "60", 1_000).unwrap(),
            61_000
        );
    }
}
