use std::{collections::HashMap, time::Duration};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::application::developer::{
    self, dashboard_repository_identity, deduplicate_pull_requests, map_error,
    merge_reviewer_summaries, pull_request_dto, pull_request_state_key, reviewer_summary,
    AuthoredPullRequestNotification, DeveloperCommandError, MyPullRequestDto,
    MyPullRequestsPageDto, PullRequestActivity, PullRequestReadAllStatus,
};
use crate::application::developer_review;
use crate::domain::models::{IntegrationHealthStatus, IntegrationKind};
use crate::infrastructure::credentials::keyring::{
    CredentialStore, OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE,
};
use crate::infrastructure::db::repositories;
use crate::infrastructure::integrations::bitbucket_dc::client::BitbucketDcClient;
use crate::infrastructure::integrations::bitbucket_dc::models::{
    BitbucketComment, BitbucketDashboardPullRequest, BitbucketPullRequest,
};

const ACTIVITY_SETTING_KEY: &str = "developer.authored_pull_request_activity";
const ACTIVITY_SCHEMA_VERSION: i64 = 2;
const CACHE_SETTING_KEY: &str = "developer.authored_pull_request_cache";
const CACHE_SCHEMA_VERSION: i64 = 1;
const MAX_PAGE_SIZE: u64 = 100;
const KEYRING_SERVICE: &str = if cfg!(debug_assertions) {
    DEV_KEYRING_SERVICE
} else {
    PRODUCTION_KEYRING_SERVICE
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ActivitySnapshot {
    #[serde(default)]
    latest_commit: Option<String>,
    #[serde(default)]
    review_fingerprint: String,
    #[serde(default)]
    auto_review_attempted: bool,
    #[serde(default)]
    auto_review_completed: bool,
    activity: PullRequestActivity,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct IntegrationActivity {
    #[serde(default)]
    initialized: bool,
    #[serde(default)]
    pull_requests: HashMap<String, ActivitySnapshot>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ActivityState {
    #[serde(default)]
    integrations: HashMap<String, IntegrationActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PullRequestCache {
    #[serde(default)]
    values: Vec<MyPullRequestDto>,
    #[serde(default)]
    last_updated_at: Option<i64>,
}

pub async fn list_authored_pull_requests_page(
    pool: &SqlitePool,
    start: u64,
    limit: u64,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    let (mut page, _) = sync_authored_pull_requests_with_notifications(pool, start, limit).await?;
    page.values.truncate(limit as usize);
    Ok(page)
}

pub async fn sync_authored_pull_requests_with_notifications(
    pool: &SqlitePool,
    _start: u64,
    limit: u64,
) -> Result<(MyPullRequestsPageDto, Vec<AuthoredPullRequestNotification>), DeveloperCommandError> {
    validate_limit(limit)?;
    let _state_guard = developer::pull_request_state_lock().lock().await;
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        developer::command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    let review_settings = developer::get_pull_request_review_settings(pool).await?;
    let mut activity_state = load_activity_state(pool).await?;
    let mut all_values = Vec::new();
    let mut notifications = Vec::new();

    let keyring = OsKeyring::new(KEYRING_SERVICE);

    for integration in integrations.into_iter().filter(|value| {
        value.kind == IntegrationKind::Bitbucket
            && value.enabled
            && value.health_status == IntegrationHealthStatus::Working
    }) {
        let secret = keyring.load(&integration.credential_ref).map_err(|_| {
            developer::command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            )
        })?;
        if secret.trim().is_empty() {
            return Err(developer::command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            ));
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| {
                developer::command_error(
                    "transport_unavailable",
                    "Bitbucket transport is unavailable",
                    true,
                )
            })?;
        let client =
            BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, secret, http)
                .map_err(map_error)?;
        let first_sync = activity_state
            .integrations
            .get(&integration.id)
            .is_none_or(|value| !value.initialized);
        let mut page_start = 0_u64;
        let mut dashboard_values = Vec::new();

        loop {
            let page = client
                .list_authored_pull_requests_page(page_start, limit)
                .await
                .map_err(|error| {
                    developer::map_error_at(
                        error,
                        "list_authored_pull_requests",
                        "GET",
                        "/rest/api/1.0/dashboard/pull-requests",
                    )
                })?;
            dashboard_values.extend(page.values.into_iter().filter(|pull_request| {
                pull_request.open
                    && pull_request.state.eq_ignore_ascii_case("OPEN")
                    && !pull_request.draft
            }));
            if page.is_last_page {
                break;
            }
            page_start = page
                .next_page_start
                .unwrap_or_else(|| page_start.saturating_add(limit));
        }

        for dashboard_pull_request in deduplicate_pull_requests(dashboard_values) {
            let pull_request_id = dashboard_pull_request.id;
            let (project_key, repository_slug) =
                dashboard_repository_identity(&dashboard_pull_request);
            let state_key = pull_request_state_key(
                &project_key,
                &repository_slug,
                &pull_request_id.to_string(),
            );
            let details = match client
                .get_pull_request(&project_key, &repository_slug, pull_request_id)
                .await
            {
                Ok(details)
                    if details.open
                        && !details.closed
                        && details.state.eq_ignore_ascii_case("OPEN") =>
                {
                    Some(details)
                }
                Ok(_) => continue,
                Err(_) => None,
            };
            let comments = if details.is_some() {
                client
                    .list_pull_request_comments(
                        &project_key,
                        &repository_slug,
                        pull_request_id,
                        100,
                    )
                    .await
                    .unwrap_or_default()
            } else {
                Vec::new()
            };
            let details_summary = details
                .as_ref()
                .map(|value| reviewer_summary(&value.participants))
                .unwrap_or_default();
            let dashboard_summary = reviewer_summary(&dashboard_pull_request.reviewers);
            let mut summary = merge_reviewer_summaries(details_summary, dashboard_summary);
            summary.comments = active_comment_count(&comments);
            let latest_commit = details
                .as_ref()
                .and_then(|value| value.from_ref.latest_commit.clone())
                .or_else(|| dashboard_pull_request.from_ref.latest_commit.clone());
            let fingerprint = details
                .as_ref()
                .map(|value| {
                    format!(
                        "details={};dashboard={}",
                        review_fingerprint(value, &comments),
                        dashboard_review_fingerprint(&dashboard_pull_request),
                    )
                })
                .unwrap_or_else(|| dashboard_review_fingerprint(&dashboard_pull_request));
            let previous_snapshot = activity_state
                .integrations
                .get(&integration.id)
                .and_then(|value| value.pull_requests.get(&state_key))
                .cloned();
            let previous_fingerprint = previous_snapshot
                .as_ref()
                .map(|value| value.review_fingerprint.clone());
            let should_auto_review = should_auto_review(
                review_settings.authored_auto_review_enabled,
                first_sync,
                latest_commit.as_deref(),
                previous_snapshot.as_ref(),
            );
            let activity = record_activity(
                &mut activity_state,
                &integration.id,
                &state_key,
                latest_commit.clone(),
                fingerprint.clone(),
                first_sync,
            );
            if should_auto_review {
                if let Some(snapshot) = activity_state
                    .integrations
                    .get_mut(&integration.id)
                    .and_then(|value| value.pull_requests.get_mut(&state_key))
                {
                    snapshot.auto_review_attempted = true;
                }
            }
            let needs_action = summary.needs_work > 0;
            let mut dto = pull_request_dto(
                &integration.id,
                &integration.account_key,
                integration.account_display_name.as_deref(),
                dashboard_pull_request,
            );
            dto.latest_commit = latest_commit.clone();
            dto.review_summary = summary;
            dto.needs_action = needs_action;
            dto.activity = activity;
            if (!first_sync && previous_fingerprint.as_deref() != Some(fingerprint.as_str())
                || should_auto_review)
                && matches!(
                    activity,
                    PullRequestActivity::New | PullRequestActivity::Updated
                )
            {
                notifications.push(AuthoredPullRequestNotification {
                    integration_id: integration.id.clone(),
                    key: state_key,
                    activity,
                    project_key: dto.project_key.clone(),
                    repository_slug: dto.repository_slug.clone(),
                    pull_request_id: dto.pull_request_id.clone(),
                    title: dto.title.clone(),
                    latest_commit,
                    needs_action,
                    auto_review: should_auto_review,
                });
            }
            all_values.push(dto);
        }
        activity_state
            .integrations
            .entry(integration.id)
            .or_default()
            .initialized = true;
    }

    save_activity_state(pool, &activity_state).await?;
    developer_review::attach_review_states(pool, &mut all_values)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Pull request review state database operation failed",
                false,
            )
        })?;
    all_values.sort_by(|left, right| {
        right
            .needs_action
            .cmp(&left.needs_action)
            .then_with(|| activity_rank(right.activity).cmp(&activity_rank(left.activity)))
            .then_with(|| right.updated_date.cmp(&left.updated_date))
            .then_with(|| left.project_key.cmp(&right.project_key))
            .then_with(|| left.repository_slug.cmp(&right.repository_slug))
            .then_with(|| left.pull_request_id.cmp(&right.pull_request_id))
    });
    let now = developer::current_unix_millis();
    save_cache(
        pool,
        &PullRequestCache {
            values: all_values.clone(),
            last_updated_at: Some(now),
        },
    )
    .await?;
    Ok((
        MyPullRequestsPageDto {
            total: Some(all_values.len() as u64),
            next_start: None,
            has_more: false,
            last_updated_at: Some(now),
            values: all_values,
        },
        notifications,
    ))
}

pub async fn get_cached_authored_pull_requests_page(
    pool: &SqlitePool,
    _start: u64,
    limit: u64,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    validate_limit(limit)?;
    let _state_guard = developer::pull_request_state_lock().lock().await;
    let cache = load_cache(pool).await?;
    let activity_state = load_activity_state(pool).await?;
    let mut values = cache.values;
    apply_activity_state(&activity_state, &mut values);
    developer_review::attach_review_states(pool, &mut values)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Pull request review state database operation failed",
                false,
            )
        })?;
    values.sort_by(|left, right| {
        right
            .needs_action
            .cmp(&left.needs_action)
            .then_with(|| activity_rank(right.activity).cmp(&activity_rank(left.activity)))
            .then_with(|| right.updated_date.cmp(&left.updated_date))
    });
    let total = values.len() as u64;
    values.truncate(limit as usize);
    Ok(MyPullRequestsPageDto {
        values,
        total: Some(total),
        next_start: None,
        has_more: false,
        last_updated_at: cache.last_updated_at,
    })
}

pub async fn mark_authored_pull_request_read(
    pool: &SqlitePool,
    integration_id: &str,
    key: &str,
    latest_commit: Option<&str>,
) -> Result<bool, DeveloperCommandError> {
    if integration_id.trim().is_empty() || key.trim().is_empty() {
        return Err(developer::command_error(
            "invalid_input",
            "Pull request identity is required",
            false,
        ));
    }
    let _state_guard = developer::pull_request_state_lock().lock().await;
    let mut state = load_activity_state(pool).await?;
    let Some(integration) = state.integrations.get_mut(integration_id) else {
        return Ok(false);
    };
    let Some(snapshot) = integration.pull_requests.get_mut(key) else {
        return Ok(false);
    };
    if latest_commit.is_some() && snapshot.latest_commit.as_deref() != latest_commit {
        return Ok(false);
    }
    snapshot.activity = PullRequestActivity::Read;
    save_activity_state(pool, &state).await?;
    Ok(true)
}

pub async fn mark_all_authored_pull_requests_read(
    pool: &SqlitePool,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    let _state_guard = developer::pull_request_state_lock().lock().await;
    let mut state = load_activity_state(pool).await?;
    let mut marked_count = 0_u64;
    for integration in state.integrations.values_mut() {
        for snapshot in integration.pull_requests.values_mut() {
            if snapshot.activity != PullRequestActivity::Read {
                marked_count = marked_count.saturating_add(1);
                snapshot.activity = PullRequestActivity::Read;
            }
        }
    }
    save_activity_state(pool, &state).await?;
    Ok(PullRequestReadAllStatus { marked_count })
}

pub async fn mark_authored_auto_review_completed(
    pool: &SqlitePool,
    integration_id: &str,
    key: &str,
    latest_commit: &str,
) -> Result<bool, DeveloperCommandError> {
    if integration_id.trim().is_empty() || key.trim().is_empty() || latest_commit.trim().is_empty()
    {
        return Ok(false);
    }
    let _state_guard = developer::pull_request_state_lock().lock().await;
    let mut state = load_activity_state(pool).await?;
    let Some(integration) = state.integrations.get_mut(integration_id) else {
        return Ok(false);
    };
    let Some(snapshot) = integration.pull_requests.get_mut(key) else {
        return Ok(false);
    };
    if snapshot.latest_commit.as_deref() != Some(latest_commit) {
        return Ok(false);
    }
    snapshot.auto_review_completed = true;
    save_activity_state(pool, &state).await?;
    Ok(true)
}
fn should_auto_review(
    enabled: bool,
    first_sync: bool,
    latest_commit: Option<&str>,
    previous: Option<&ActivitySnapshot>,
) -> bool {
    enabled
        && !first_sync
        && latest_commit.is_some()
        && previous.is_none_or(|snapshot| {
            snapshot.latest_commit.as_deref() != latest_commit
                || (snapshot.auto_review_attempted && !snapshot.auto_review_completed)
        })
}

fn record_activity(
    state: &mut ActivityState,
    integration_id: &str,
    key: &str,
    latest_commit: Option<String>,
    review_fingerprint: String,
    first_sync: bool,
) -> PullRequestActivity {
    let integration = state
        .integrations
        .entry(integration_id.to_owned())
        .or_default();
    let activity = match integration.pull_requests.get(key) {
        None if first_sync => PullRequestActivity::Read,
        None => PullRequestActivity::New,
        Some(previous)
            if previous.latest_commit == latest_commit
                && previous.review_fingerprint == review_fingerprint =>
        {
            previous.activity
        }
        Some(_) => PullRequestActivity::Updated,
    };
    let auto_review_attempted = integration
        .pull_requests
        .get(key)
        .filter(|previous| previous.latest_commit == latest_commit)
        .map(|previous| previous.auto_review_attempted)
        .unwrap_or(false);
    let auto_review_completed = integration
        .pull_requests
        .get(key)
        .filter(|previous| previous.latest_commit == latest_commit)
        .map(|previous| previous.auto_review_completed)
        .unwrap_or(false);
    integration.pull_requests.insert(
        key.to_owned(),
        ActivitySnapshot {
            latest_commit,
            review_fingerprint,
            auto_review_attempted,
            auto_review_completed,
            activity,
        },
    );
    activity
}

fn active_comment_count(comments: &[BitbucketComment]) -> u64 {
    comments
        .iter()
        .map(|comment| {
            u64::from(!comment.deleted.unwrap_or(false)) + active_comment_count(&comment.comments)
        })
        .sum()
}

fn dashboard_review_fingerprint(pull_request: &BitbucketDashboardPullRequest) -> String {
    let mut reviewers = pull_request
        .reviewers
        .iter()
        .map(|participant| {
            format!(
                "{}:{}:{}:{}",
                participant.user.name.as_deref().unwrap_or_default(),
                participant.user.slug.as_deref().unwrap_or_default(),
                participant
                    .approved
                    .map_or_else(String::new, |value| value.to_string()),
                participant.status.as_deref().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();
    reviewers.sort_unstable();
    format!(
        "dashboard-version={};updated={};commit={};reviewers={}",
        pull_request.version,
        pull_request.updated_date.unwrap_or_default(),
        pull_request
            .from_ref
            .latest_commit
            .as_deref()
            .unwrap_or_default(),
        reviewers.join("|")
    )
}

fn collect_comment_events(comments: &[BitbucketComment], events: &mut Vec<String>) {
    for comment in comments {
        events.push(format!(
            "{}:{}:{}:{}:{}",
            comment.id,
            comment.version,
            comment.created_date.unwrap_or_default(),
            comment.updated_date.unwrap_or_default(),
            comment.deleted.unwrap_or(false)
        ));
        collect_comment_events(&comment.comments, events);
    }
}

fn review_fingerprint(
    pull_request: &BitbucketPullRequest,
    comments: &[BitbucketComment],
) -> String {
    let mut reviewers = pull_request
        .participants
        .iter()
        .filter(|participant| participant.role.eq_ignore_ascii_case("REVIEWER"))
        .map(|participant| {
            format!(
                "{}:{}:{}:{}",
                participant.user.name.as_deref().unwrap_or_default(),
                participant.user.slug.as_deref().unwrap_or_default(),
                participant
                    .approved
                    .map_or_else(String::new, |value| value.to_string()),
                participant.status.as_deref().unwrap_or_default()
            )
        })
        .collect::<Vec<_>>();
    reviewers.sort_unstable();
    let mut comment_events = Vec::new();
    collect_comment_events(comments, &mut comment_events);
    comment_events.sort_unstable();
    format!(
        "version={};updated={};commit={};reviewers={};comments={}",
        pull_request.version,
        pull_request.updated_date.unwrap_or_default(),
        pull_request
            .from_ref
            .latest_commit
            .as_deref()
            .unwrap_or_default(),
        reviewers.join("|"),
        comment_events.join("|")
    )
}

fn apply_activity_state(state: &ActivityState, values: &mut [MyPullRequestDto]) {
    for pull_request in values {
        let key = pull_request_state_key(
            &pull_request.project_key,
            &pull_request.repository_slug,
            &pull_request.pull_request_id,
        );
        if let Some(snapshot) = state
            .integrations
            .get(&pull_request.integration_id)
            .and_then(|integration| integration.pull_requests.get(&key))
        {
            pull_request.activity = snapshot.activity;
        }
    }
}

fn activity_rank(activity: PullRequestActivity) -> u8 {
    match activity {
        PullRequestActivity::New => 3,
        PullRequestActivity::Updated => 2,
        PullRequestActivity::Read => 1,
    }
}

fn validate_limit(limit: u64) -> Result<(), DeveloperCommandError> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(developer::command_error(
            "invalid_input",
            &format!("Pull request page size must be between 1 and {MAX_PAGE_SIZE}"),
            false,
        ));
    }
    Ok(())
}

async fn load_activity_state(pool: &SqlitePool) -> Result<ActivityState, DeveloperCommandError> {
    let value = repositories::get_setting(pool, ACTIVITY_SETTING_KEY)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Authored pull request activity database operation failed",
                false,
            )
        })?;
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| {
                developer::command_error(
                    "invalid_settings",
                    "Saved authored pull request activity state is invalid",
                    false,
                )
            })
        })
        .transpose()
        .map(|state| state.unwrap_or_default())
}

async fn save_activity_state(
    pool: &SqlitePool,
    state: &ActivityState,
) -> Result<(), DeveloperCommandError> {
    let value = serde_json::to_string(state).map_err(|_| {
        developer::command_error(
            "database",
            "Authored pull request activity state could not be serialized",
            false,
        )
    })?;
    repositories::upsert_setting(pool, ACTIVITY_SETTING_KEY, &value, ACTIVITY_SCHEMA_VERSION)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Authored pull request activity database operation failed",
                false,
            )
        })
}

async fn load_cache(pool: &SqlitePool) -> Result<PullRequestCache, DeveloperCommandError> {
    let value = repositories::get_setting(pool, CACHE_SETTING_KEY)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Authored pull request cache database operation failed",
                false,
            )
        })?;
    let Some(value) = value else {
        return Ok(PullRequestCache {
            values: Vec::new(),
            last_updated_at: None,
        });
    };
    serde_json::from_str(&value).map_err(|_| {
        developer::command_error(
            "invalid_settings",
            "Saved authored pull request cache is invalid",
            false,
        )
    })
}

async fn save_cache(
    pool: &SqlitePool,
    cache: &PullRequestCache,
) -> Result<(), DeveloperCommandError> {
    let mut storage_cache = cache.clone();
    for pull_request in &mut storage_cache.values {
        pull_request.review = None;
    }
    let value = serde_json::to_string(&storage_cache).map_err(|_| {
        developer::command_error(
            "database",
            "Authored pull request cache could not be serialized",
            false,
        )
    })?;
    repositories::upsert_setting(pool, CACHE_SETTING_KEY, &value, CACHE_SCHEMA_VERSION)
        .await
        .map_err(|_| {
            developer::command_error(
                "database",
                "Authored pull request cache database operation failed",
                false,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::developer::PullRequestReviewSummaryDto;

    #[test]
    fn review_event_fingerprint_changes_when_a_comment_is_added() {
        let pull_request = BitbucketPullRequest {
            id: 1,
            version: 1,
            title: "Example".into(),
            description: None,
            state: "OPEN".into(),
            open: true,
            closed: false,
            created_date: None,
            updated_date: None,
            from_ref: crate::infrastructure::integrations::bitbucket_dc::models::BitbucketRef {
                id: "refs/heads/feature".into(),
                display_id: "feature".into(),
                latest_commit: Some("commit-1".into()),
                repository: None,
            },
            to_ref: crate::infrastructure::integrations::bitbucket_dc::models::BitbucketRef {
                id: "refs/heads/master".into(),
                display_id: "master".into(),
                latest_commit: Some("commit-0".into()),
                repository: None,
            },
            locked: None,
            author: None,
            reviewers: Vec::new(),
            participants: Vec::new(),
            properties: None,
            links: None,
        };
        let empty = review_fingerprint(&pull_request, &[]);
        let with_comment = review_fingerprint(
            &pull_request,
            &[BitbucketComment {
                id: 7,
                version: 1,
                text: "synthetic".into(),
                author: None,
                created_date: Some(1),
                updated_date: Some(1),
                deleted: Some(false),
                comments: Vec::new(),
                permitted: None,
                anchor: None,
                links: None,
            }],
        );
        assert_ne!(empty, with_comment);
    }

    use crate::infrastructure::integrations::bitbucket_dc::models::{
        BitbucketParticipant, BitbucketUser,
    };

    #[test]
    fn review_event_fingerprint_changes_when_reviewer_decision_changes() {
        let mut approved = BitbucketPullRequest {
            id: 1,
            version: 1,
            title: "Example".into(),
            description: None,
            state: "OPEN".into(),
            open: true,
            closed: false,
            created_date: None,
            updated_date: None,
            from_ref: crate::infrastructure::integrations::bitbucket_dc::models::BitbucketRef {
                id: "refs/heads/feature".into(),
                display_id: "feature".into(),
                latest_commit: Some("commit-1".into()),
                repository: None,
            },
            to_ref: crate::infrastructure::integrations::bitbucket_dc::models::BitbucketRef {
                id: "refs/heads/master".into(),
                display_id: "master".into(),
                latest_commit: Some("commit-0".into()),
                repository: None,
            },
            locked: None,
            author: None,
            reviewers: Vec::new(),
            participants: vec![BitbucketParticipant {
                user: BitbucketUser {
                    name: Some("reviewer".into()),
                    display_name: Some("Reviewer".into()),
                    email_address: None,
                    id: Some(2),
                    active: Some(true),
                    slug: Some("reviewer".into()),
                    links: None,
                },
                role: "REVIEWER".into(),
                approved: Some(true),
                status: Some("APPROVED".into()),
            }],
            properties: None,
            links: None,
        };
        let approved_fingerprint = review_fingerprint(&approved, &[]);
        approved.participants[0].approved = Some(false);
        approved.participants[0].status = Some("NEEDS_WORK".into());

        assert_ne!(approved_fingerprint, review_fingerprint(&approved, &[]));
    }
    #[test]
    fn activity_is_read_on_first_sync_and_updated_after_event_change() {
        let mut state = ActivityState::default();
        let first = record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-1".into(),
            true,
        );
        let unchanged = record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-1".into(),
            false,
        );
        let changed = record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-2".into(),
            false,
        );
        assert_eq!(first, PullRequestActivity::Read);
        assert_eq!(unchanged, PullRequestActivity::Read);
        assert_eq!(changed, PullRequestActivity::Updated);
    }

    #[tokio::test]
    async fn marks_all_authored_pull_requests_read_without_changing_review_state() {
        let directory = tempfile::tempdir().unwrap();
        let pool =
            crate::infrastructure::db::open_database(&directory.path().join("mework.sqlite"))
                .await
                .unwrap();
        let mut state = ActivityState::default();
        state.integrations.insert(
            "bb".into(),
            IntegrationActivity {
                initialized: true,
                pull_requests: std::collections::HashMap::from([
                    (
                        "PROJ/repo/1".into(),
                        ActivitySnapshot {
                            latest_commit: Some("commit-1".into()),
                            review_fingerprint: "fingerprint-1".into(),
                            auto_review_attempted: true,
                            auto_review_completed: true,
                            activity: PullRequestActivity::Updated,
                        },
                    ),
                    (
                        "PROJ/repo/2".into(),
                        ActivitySnapshot {
                            latest_commit: Some("commit-2".into()),
                            review_fingerprint: "fingerprint-2".into(),
                            auto_review_attempted: false,
                            auto_review_completed: false,
                            activity: PullRequestActivity::Read,
                        },
                    ),
                ]),
            },
        );
        save_activity_state(&pool, &state).await.unwrap();

        let result = mark_all_authored_pull_requests_read(&pool).await.unwrap();

        assert_eq!(result.marked_count, 1);
        let saved = load_activity_state(&pool).await.unwrap();
        let snapshots = &saved.integrations["bb"].pull_requests;
        assert_eq!(snapshots["PROJ/repo/1"].activity, PullRequestActivity::Read);
        assert_eq!(
            snapshots["PROJ/repo/1"].latest_commit.as_deref(),
            Some("commit-1")
        );
        assert!(snapshots["PROJ/repo/1"].auto_review_attempted);
        assert!(snapshots["PROJ/repo/1"].auto_review_completed);
        assert_eq!(snapshots["PROJ/repo/2"].activity, PullRequestActivity::Read);
    }
    #[test]
    fn auto_review_completion_is_preserved_without_a_new_commit_and_reset_for_new_commit() {
        let mut state = ActivityState::default();
        record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-1".into(),
            false,
        );
        let snapshot = state
            .integrations
            .get_mut("bb")
            .and_then(|integration| integration.pull_requests.get_mut("PROJ/repo/1"))
            .expect("snapshot exists");
        snapshot.auto_review_attempted = true;
        snapshot.auto_review_completed = true;

        record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-2".into(),
            false,
        );
        assert!(state
            .integrations
            .get("bb")
            .and_then(|integration| integration.pull_requests.get("PROJ/repo/1"))
            .is_some_and(|snapshot| snapshot.auto_review_completed));

        record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-2".into()),
            "fingerprint-3".into(),
            false,
        );
        assert!(!state
            .integrations
            .get("bb")
            .and_then(|integration| integration.pull_requests.get("PROJ/repo/1"))
            .is_some_and(|snapshot| snapshot.auto_review_completed));
    }
    #[test]
    fn auto_review_runs_for_new_commit_or_pending_retry_only() {
        let mut state = ActivityState::default();
        record_activity(
            &mut state,
            "bb",
            "PROJ/repo/1",
            Some("commit-1".into()),
            "fingerprint-1".into(),
            false,
        );
        let previous = state
            .integrations
            .get("bb")
            .and_then(|integration| integration.pull_requests.get("PROJ/repo/1"))
            .expect("snapshot exists")
            .clone();

        assert!(!should_auto_review(
            true,
            false,
            Some("commit-1"),
            Some(&previous)
        ));
        assert!(should_auto_review(
            true,
            false,
            Some("commit-2"),
            Some(&previous)
        ));

        let mut pending = previous.clone();
        pending.auto_review_attempted = true;
        assert!(should_auto_review(
            true,
            false,
            Some("commit-1"),
            Some(&pending)
        ));
        pending.auto_review_completed = true;
        assert!(!should_auto_review(
            true,
            false,
            Some("commit-1"),
            Some(&pending)
        ));
        assert!(!should_auto_review(
            true,
            true,
            Some("commit-2"),
            Some(&previous)
        ));
    }

    #[test]
    fn cached_values_restore_persisted_activity_state() {
        let mut values = vec![MyPullRequestDto {
            integration_id: "bb".into(),
            pull_request_id: "1".into(),
            title: "Owned".into(),
            state: "OPEN".into(),
            repository_slug: "repo".into(),
            repository_name: "Repo".into(),
            project_key: "PROJ".into(),
            source_branch: "feature".into(),
            target_branch: "main".into(),
            author_display_name: "Current User".into(),
            updated_date: Some(1),
            url: None,
            my_decision: "not_reviewed".into(),
            author_avatar_url: None,
            latest_commit: Some("commit-1".into()),
            review_summary: PullRequestReviewSummaryDto::default(),
            needs_action: false,
            activity: PullRequestActivity::New,
            review: None,
        }];
        let mut state = ActivityState::default();
        state.integrations.insert(
            "bb".into(),
            IntegrationActivity {
                initialized: true,
                pull_requests: std::collections::HashMap::from([(
                    "PROJ/repo/1".into(),
                    ActivitySnapshot {
                        latest_commit: Some("commit-1".into()),
                        review_fingerprint: "fingerprint".into(),
                        auto_review_attempted: false,
                        auto_review_completed: false,
                        activity: PullRequestActivity::Read,
                    },
                )]),
            },
        );

        apply_activity_state(&state, &mut values);

        assert_eq!(values[0].activity, PullRequestActivity::Read);
    }
    #[test]
    fn counts_only_active_pull_request_comments() {
        let comments = vec![
            BitbucketComment {
                id: 1,
                version: 1,
                text: "active".into(),
                author: None,
                created_date: None,
                updated_date: None,
                deleted: Some(false),
                comments: vec![BitbucketComment {
                    id: 3,
                    version: 1,
                    text: "reply".into(),
                    author: None,
                    created_date: None,
                    updated_date: None,
                    deleted: Some(false),
                    comments: Vec::new(),
                    permitted: None,
                    anchor: None,
                    links: None,
                }],
                permitted: None,
                anchor: None,
                links: None,
            },
            BitbucketComment {
                id: 2,
                version: 1,
                text: "deleted".into(),
                author: None,
                created_date: None,
                updated_date: None,
                deleted: Some(true),
                comments: Vec::new(),
                permitted: None,
                anchor: None,
                links: None,
            },
        ];

        assert_eq!(active_comment_count(&comments), 2);
    }

    #[test]
    fn summary_dto_keeps_author_review_counters_serializable() {
        let summary = PullRequestReviewSummaryDto {
            approved: 2,
            needs_work: 1,
            comments: 3,
        };
        assert_eq!(summary.approved, 2);
        assert_eq!(summary.needs_work, 1);
    }
}
