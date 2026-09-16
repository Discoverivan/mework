use std::{
    collections::HashMap,
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

use crate::application::developer_review::{self, PullRequestReviewDto};
use crate::domain::models::{IntegrationHealthStatus, IntegrationKind};
use crate::infrastructure::credentials::keyring::CredentialStore;
#[cfg(debug_assertions)]
use crate::infrastructure::credentials::keyring::DevCredentialStore;
#[cfg(not(debug_assertions))]
use crate::infrastructure::credentials::keyring::OsKeyring;
use crate::infrastructure::db::repositories;
use crate::infrastructure::integrations::bitbucket_dc::client::{
    BitbucketDcClient, BitbucketInlineComment,
};
use crate::infrastructure::integrations::bitbucket_dc::error::{
    BitbucketDcError, BitbucketHttpErrorKind,
};
use crate::infrastructure::integrations::bitbucket_dc::models::{
    BitbucketDashboardPullRequest, BitbucketParticipant, BitbucketPullRequestAuthor, BitbucketUser,
};
use sqlx::SqlitePool;

#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "com.discoverivan.app.mework";
const REVIEW_FILTERS_SETTING_KEY: &str = "developer.pull_request_review_filters";
const REVIEW_FILTERS_SCHEMA_VERSION: i64 = 3;
const PULL_REQUEST_ACTIVITY_SETTING_KEY: &str = "developer.pull_request_activity";
const PULL_REQUEST_ACTIVITY_SCHEMA_VERSION: i64 = 1;
const PULL_REQUEST_CACHE_SETTING_KEY: &str = "developer.pull_request_cache";
const PULL_REQUEST_CACHE_SCHEMA_VERSION: i64 = 1;
const MAX_REVIEW_FILTER_ENTRIES: usize = 100;
const MAX_PAGE_SIZE: u64 = 100;

static PULL_REQUEST_STATE_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub(crate) fn pull_request_state_lock() -> &'static tokio::sync::Mutex<()> {
    PULL_REQUEST_STATE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReviewSettings {
    #[serde(default)]
    pub repository_blacklist: Vec<String>,
    #[serde(default)]
    pub creator_blacklist: Vec<String>,
    #[serde(default)]
    pub repository_whitelist: Vec<String>,
    #[serde(default)]
    pub creator_whitelist: Vec<String>,
    #[serde(default)]
    pub auto_review_enabled: bool,
    #[serde(default)]
    pub authored_auto_review_enabled: bool,
}

pub async fn get_pull_request_review_settings(
    pool: &SqlitePool,
) -> Result<PullRequestReviewSettings, DeveloperCommandError> {
    let value = repositories::get_setting(pool, REVIEW_FILTERS_SETTING_KEY)
        .await
        .map_err(|_| {
            command_error(
                "database",
                "Developer settings database operation failed",
                false,
            )
        })?;
    let Some(value) = value else {
        return Ok(PullRequestReviewSettings::default());
    };
    let settings = serde_json::from_str::<PullRequestReviewSettings>(&value).map_err(|_| {
        command_error(
            "invalid_settings",
            "Saved pull request review settings are invalid",
            false,
        )
    })?;
    normalize_settings(settings)
}

pub async fn save_pull_request_review_settings(
    pool: &SqlitePool,
    settings: PullRequestReviewSettings,
) -> Result<PullRequestReviewSettings, DeveloperCommandError> {
    let settings = normalize_settings(settings)?;
    let value = serde_json::to_string(&settings).map_err(|_| {
        command_error(
            "database",
            "Developer settings could not be serialized",
            false,
        )
    })?;
    repositories::upsert_setting(
        pool,
        REVIEW_FILTERS_SETTING_KEY,
        &value,
        REVIEW_FILTERS_SCHEMA_VERSION,
    )
    .await
    .map_err(|_| {
        command_error(
            "database",
            "Developer settings database operation failed",
            false,
        )
    })?;
    Ok(settings)
}

fn normalize_settings(
    settings: PullRequestReviewSettings,
) -> Result<PullRequestReviewSettings, DeveloperCommandError> {
    Ok(PullRequestReviewSettings {
        repository_blacklist: normalize_filter_values(
            settings.repository_blacklist,
            "repository blacklist",
        )?,
        creator_blacklist: normalize_filter_values(
            settings.creator_blacklist,
            "creator blacklist",
        )?,
        repository_whitelist: normalize_filter_values(
            settings.repository_whitelist,
            "repository whitelist",
        )?,
        creator_whitelist: normalize_filter_values(
            settings.creator_whitelist,
            "creator whitelist",
        )?,
        auto_review_enabled: settings.auto_review_enabled,
        authored_auto_review_enabled: settings.authored_auto_review_enabled,
    })
}

fn normalize_filter_values(
    values: Vec<String>,
    label: &str,
) -> Result<Vec<String>, DeveloperCommandError> {
    if values.len() > MAX_REVIEW_FILTER_ENTRIES {
        return Err(command_error(
            "invalid_input",
            &format!("The {label} cannot contain more than {MAX_REVIEW_FILTER_ENTRIES} entries"),
            false,
        ));
    }
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > 200 || value.chars().any(char::is_control) {
            return Err(command_error(
                "invalid_input",
                &format!("The {label} contains an invalid entry"),
                false,
            ));
        }
        if !normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(value))
        {
            normalized.push(value.to_owned());
        }
    }
    Ok(normalized)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestActivity {
    New,
    Updated,
    Read,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PullRequestActivitySnapshot {
    latest_commit: Option<String>,
    activity: PullRequestActivity,
    #[serde(default)]
    auto_review_completed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct IntegrationPullRequestActivity {
    #[serde(default)]
    initialized: bool,
    #[serde(default)]
    pull_requests: HashMap<String, PullRequestActivitySnapshot>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PullRequestActivityState {
    #[serde(default)]
    integrations: HashMap<String, IntegrationPullRequestActivity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReviewSummaryDto {
    pub approved: u64,
    pub needs_work: u64,
    #[serde(default)]
    pub comments: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MyPullRequestDto {
    pub integration_id: String,
    pub pull_request_id: String,
    pub title: String,
    pub state: String,
    pub repository_slug: String,
    pub repository_name: String,
    pub project_key: String,
    pub source_branch: String,
    pub target_branch: String,
    pub author_display_name: String,
    pub updated_date: Option<i64>,
    pub url: Option<String>,
    pub my_decision: String,
    pub author_avatar_url: Option<String>,
    pub latest_commit: Option<String>,
    #[serde(default)]
    pub review_summary: PullRequestReviewSummaryDto,
    #[serde(default)]
    pub needs_action: bool,
    pub activity: PullRequestActivity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<PullRequestReviewDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReviewNotification {
    pub integration_id: String,
    pub key: String,
    pub activity: PullRequestActivity,
    pub project_key: String,
    pub repository_slug: String,
    pub pull_request_id: String,
    pub title: String,
    pub latest_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthoredPullRequestNotification {
    pub integration_id: String,
    pub key: String,
    pub activity: PullRequestActivity,
    pub project_key: String,
    pub repository_slug: String,
    pub pull_request_id: String,
    pub title: String,
    pub latest_commit: Option<String>,
    pub needs_action: bool,
    pub auto_review: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestActivityStatus {
    pub integration_id: String,
    pub pull_request_id: String,
    pub activity: PullRequestActivity,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReadAllStatus {
    pub marked_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MyPullRequestsPageDto {
    pub values: Vec<MyPullRequestDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub next_start: Option<u64>,
    pub has_more: bool,
    pub last_updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PullRequestCache {
    #[serde(default)]
    values: Vec<MyPullRequestDto>,
    #[serde(default)]
    last_updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketUserDto {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub slug: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketRepositoryDto {
    pub project_key: String,
    pub project_name: String,
    pub repository_slug: String,
    pub repository_name: String,
}

pub async fn search_bitbucket_repositories(
    pool: &SqlitePool,
    query: &str,
) -> Result<Vec<BitbucketRepositoryDto>, DeveloperCommandError> {
    let query = query.trim();
    if query.chars().count() < 3 {
        return Err(command_error(
            "invalid_input",
            "Enter at least 3 characters to search Bitbucket repositories",
            false,
        ));
    }
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    #[cfg(debug_assertions)]
    let keyring = DevCredentialStore::from_integrations(
        integrations
            .iter()
            .map(|integration| (integration.credential_ref.clone(), integration.kind)),
    );
    #[cfg(not(debug_assertions))]
    let keyring = OsKeyring::new(KEYRING_SERVICE);
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for integration in integrations.into_iter().filter(|value| {
        value.kind == IntegrationKind::Bitbucket
            && value.enabled
            && value.health_status == IntegrationHealthStatus::Working
    }) {
        let secret = keyring.load(&integration.credential_ref).map_err(|_| {
            command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            )
        })?;
        if secret.trim().is_empty() {
            return Err(command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            ));
        }
        let mut builder = Client::builder().timeout(Duration::from_secs(30));
        if integration.allow_insecure_tls {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let http = builder.build().map_err(|_| {
            command_error(
                "transport_unavailable",
                "Bitbucket transport is unavailable",
                true,
            )
        })?;
        let client =
            BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, secret, http)
                .map_err(map_error)?;
        let page = client
            .search_repositories(query, 20)
            .await
            .map_err(map_error)?;
        for repository in page.values {
            let key = format!("{}/{}", repository.project.key, repository.slug);
            if seen.insert(key) {
                result.push(BitbucketRepositoryDto {
                    project_key: repository.project.key,
                    project_name: repository.project.name,
                    repository_slug: repository.slug,
                    repository_name: repository.name,
                });
            }
        }
    }
    Ok(result)
}

pub async fn search_bitbucket_users(
    pool: &SqlitePool,
    query: &str,
) -> Result<Vec<BitbucketUserDto>, DeveloperCommandError> {
    let query = query.trim();
    if query.chars().count() < 3 {
        return Err(command_error(
            "invalid_input",
            "Enter at least 3 characters to search Bitbucket users",
            false,
        ));
    }
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    #[cfg(debug_assertions)]
    let keyring = DevCredentialStore::from_integrations(
        integrations
            .iter()
            .map(|integration| (integration.credential_ref.clone(), integration.kind)),
    );
    #[cfg(not(debug_assertions))]
    let keyring = OsKeyring::new(KEYRING_SERVICE);
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for integration in integrations.into_iter().filter(|value| {
        value.kind == IntegrationKind::Bitbucket
            && value.enabled
            && value.health_status == IntegrationHealthStatus::Working
    }) {
        let secret = keyring.load(&integration.credential_ref).map_err(|_| {
            command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            )
        })?;
        if secret.trim().is_empty() {
            return Err(command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            ));
        }
        let mut builder = Client::builder().timeout(Duration::from_secs(30));
        if integration.allow_insecure_tls {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let http = builder.build().map_err(|_| {
            command_error(
                "transport_unavailable",
                "Bitbucket transport is unavailable",
                true,
            )
        })?;
        let client =
            BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, secret, http)
                .map_err(map_error)?;
        let page = client.search_users(query, 20).await.map_err(map_error)?;
        for user in page.values {
            let identity = user
                .name
                .as_deref()
                .or(user.slug.as_deref())
                .or(user.display_name.as_deref());
            let Some(identity) = identity else { continue };
            if seen.insert(identity.to_lowercase()) {
                result.push(BitbucketUserDto {
                    name: user.name,
                    display_name: user.display_name,
                    slug: user.slug,
                });
            }
        }
    }
    Ok(result)
}

pub async fn list_my_pull_requests_page(
    pool: &SqlitePool,
    start: u64,
    limit: u64,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    sync_my_pull_requests_with_notifications(pool, start, limit)
        .await
        .map(|(page, _)| page)
}

pub async fn pull_request_diff(
    pool: &SqlitePool,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    expected_commit: &str,
) -> Result<String, DeveloperCommandError> {
    let pull_request_id = pull_request_id
        .parse::<u64>()
        .map_err(|_| command_error("invalid_input", "Pull request id is invalid", false))?;
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    let integration = integrations
        .into_iter()
        .find(|value| {
            value.id == integration_id
                && value.kind == IntegrationKind::Bitbucket
                && value.enabled
                && value.health_status == IntegrationHealthStatus::Working
        })
        .ok_or_else(|| {
            command_error(
                "integration_unavailable",
                "A working Bitbucket integration is required for AI review",
                false,
            )
        })?;
    #[cfg(debug_assertions)]
    let keyring = DevCredentialStore::from_integrations(std::iter::once((
        integration.credential_ref.clone(),
        integration.kind,
    )));
    #[cfg(not(debug_assertions))]
    let keyring = OsKeyring::new(KEYRING_SERVICE);
    let secret = keyring.load(&integration.credential_ref).map_err(|_| {
        command_error(
            "missing_credential",
            "Bitbucket credential is missing",
            false,
        )
    })?;
    if secret.trim().is_empty() {
        return Err(command_error(
            "missing_credential",
            "Bitbucket credential is missing",
            false,
        ));
    }
    let mut builder = Client::builder().timeout(Duration::from_secs(30));
    if integration.allow_insecure_tls {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let http = builder.build().map_err(|_| {
        command_error(
            "transport_unavailable",
            "Bitbucket transport is unavailable",
            true,
        )
    })?;
    let client =
        BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, secret, http)
            .map_err(map_error)?;
    let current_pull_request = client
        .get_pull_request(project_key, repository_slug, pull_request_id)
        .await
        .map_err(map_error)?;
    if !current_pull_request.open || !current_pull_request.state.eq_ignore_ascii_case("OPEN") {
        return Err(command_error(
            "pull_request_unavailable",
            "Pull request is no longer open",
            false,
        ));
    }
    if current_pull_request.from_ref.latest_commit.as_deref() != Some(expected_commit) {
        return Err(command_error(
            "pull_request_changed",
            "Pull request changed since it was loaded; refresh the list and try again",
            false,
        ));
    }
    client
        .pull_request_diff(project_key, repository_slug, pull_request_id)
        .await
        .map_err(map_error)
}

pub async fn sync_my_pull_requests_with_notifications(
    pool: &SqlitePool,
    _start: u64,
    limit: u64,
) -> Result<(MyPullRequestsPageDto, Vec<PullRequestReviewNotification>), DeveloperCommandError> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(command_error(
            "invalid_input",
            &format!("Pull request page size must be between 1 and {MAX_PAGE_SIZE}"),
            false,
        ));
    }
    let _state_guard = pull_request_state_lock().lock().await;
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    let review_settings = get_pull_request_review_settings(pool).await?;
    let cached_baseline = load_pull_request_cache(pool).await?;
    let mut activity_state = load_pull_request_activity_state(pool).await?;
    for pull_request in deduplicate_cached_pull_requests(cached_baseline.values) {
        let state_key = pull_request_state_key(
            &pull_request.project_key,
            &pull_request.repository_slug,
            &pull_request.pull_request_id,
        );
        if let Some(integration) = activity_state
            .integrations
            .get_mut(&pull_request.integration_id)
        {
            let lookup_key = if integration.pull_requests.contains_key(&state_key) {
                state_key
            } else {
                pull_request.pull_request_id.clone()
            };
            if let Some(snapshot) = integration.pull_requests.get_mut(&lookup_key) {
                if pull_request.latest_commit.is_some() {
                    snapshot.latest_commit = pull_request.latest_commit;
                }
            }
        }
    }
    #[cfg(debug_assertions)]
    let keyring = DevCredentialStore::from_integrations(
        integrations
            .iter()
            .map(|integration| (integration.credential_ref.clone(), integration.kind)),
    );
    #[cfg(not(debug_assertions))]
    let keyring = OsKeyring::new(KEYRING_SERVICE);
    let mut all_values = Vec::new();
    let mut notifications = Vec::new();

    for integration in integrations.into_iter().filter(|value| {
        value.kind == IntegrationKind::Bitbucket
            && value.enabled
            && value.health_status == IntegrationHealthStatus::Working
    }) {
        let secret = keyring.load(&integration.credential_ref).map_err(|_| {
            command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            )
        })?;
        if secret.trim().is_empty() {
            return Err(command_error(
                "missing_credential",
                "Bitbucket credential is missing",
                false,
            ));
        }
        let mut builder = Client::builder().timeout(Duration::from_secs(30));
        if integration.allow_insecure_tls {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let http = builder.build().map_err(|_| {
            command_error(
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
        let mut pull_request_values = Vec::new();

        loop {
            let page = client
                .list_my_pull_requests_page(page_start, limit)
                .await
                .map_err(map_error)?;
            pull_request_values.extend(page.values.into_iter().filter(|pull_request| {
                pull_request.open && pull_request.state.eq_ignore_ascii_case("OPEN")
            }));
            if page.is_last_page {
                break;
            }
            page_start = page
                .next_page_start
                .unwrap_or_else(|| page_start.saturating_add(limit));
        }

        for pull_request in deduplicate_pull_requests(pull_request_values) {
            let pull_request_id = pull_request.id.to_string();
            let (project_key, repository_slug) = dashboard_repository_identity(&pull_request);
            let state_key =
                pull_request_state_key(&project_key, &repository_slug, &pull_request_id);
            let previous = activity_state
                .integrations
                .get(&integration.id)
                .and_then(|value| {
                    value
                        .pull_requests
                        .get(&state_key)
                        .or_else(|| value.pull_requests.get(&pull_request_id))
                })
                .cloned();
            let latest_commit = pull_request.from_ref.latest_commit.clone();
            let should_auto_review = review_settings.auto_review_enabled
                && !first_sync
                && latest_commit.is_some()
                && previous.as_ref().is_none_or(|snapshot| {
                    snapshot.latest_commit.as_ref() != latest_commit.as_ref()
                        || !snapshot.auto_review_completed
                });
            let should_notify =
                should_notify_pull_request(previous.as_ref(), latest_commit.as_ref(), first_sync)
                    || should_auto_review;
            let activity = record_pull_request_snapshot_with_identity(
                &mut activity_state,
                &integration.id,
                &project_key,
                &repository_slug,
                &pull_request_id,
                latest_commit,
                first_sync,
            );
            let mut dto = pull_request_dto(
                &integration.id,
                &integration.account_key,
                integration.account_display_name.as_deref(),
                pull_request,
            );
            dto.activity = activity;
            if should_notify
                && matches!(
                    activity,
                    PullRequestActivity::New | PullRequestActivity::Updated
                )
                && matches_review_settings(&dto, &review_settings)
            {
                notifications.push(PullRequestReviewNotification {
                    integration_id: integration.id.clone(),
                    key: format!("{}:{state_key}", integration.id),
                    activity,
                    project_key,
                    repository_slug,
                    pull_request_id,
                    title: dto.title.clone(),
                    latest_commit: dto.latest_commit.clone(),
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

    save_pull_request_activity_state(pool, &activity_state).await?;
    developer_review::attach_review_states(pool, &mut all_values)
        .await
        .map_err(|_| {
            command_error(
                "database",
                "Pull request review state database operation failed",
                false,
            )
        })?;
    all_values.sort_by(compare_pull_requests);
    let last_updated_at = Some(current_unix_millis());
    save_pull_request_cache(
        pool,
        &PullRequestCache {
            values: all_values.clone(),
            last_updated_at,
        },
    )
    .await?;
    let result: Vec<_> = all_values
        .into_iter()
        .filter(|pull_request| matches_review_settings(pull_request, &review_settings))
        .collect();
    Ok((
        MyPullRequestsPageDto {
            total: Some(result.len() as u64),
            values: result,
            next_start: None,
            has_more: false,
            last_updated_at,
        },
        notifications,
    ))
}

pub async fn get_cached_my_pull_requests_page(
    pool: &SqlitePool,
    limit: u64,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    if limit == 0 || limit > MAX_PAGE_SIZE {
        return Err(command_error(
            "invalid_input",
            &format!("Pull request page size must be between 1 and {MAX_PAGE_SIZE}"),
            false,
        ));
    }
    let _state_guard = pull_request_state_lock().lock().await;
    let review_settings = get_pull_request_review_settings(pool).await?;
    let activity_state = load_pull_request_activity_state(pool).await?;
    let cache = load_pull_request_cache(pool).await?;
    let mut values: Vec<_> = deduplicate_cached_pull_requests(cache.values)
        .into_iter()
        .map(|mut pull_request| {
            let state_key = pull_request_state_key(
                &pull_request.project_key,
                &pull_request.repository_slug,
                &pull_request.pull_request_id,
            );
            if let Some(integration) = activity_state
                .integrations
                .get(&pull_request.integration_id)
            {
                let snapshot = integration
                    .pull_requests
                    .get(&state_key)
                    .or_else(|| integration.pull_requests.get(&pull_request.pull_request_id));
                if let Some(snapshot) = snapshot {
                    pull_request.activity = snapshot.activity;
                }
            }
            pull_request
        })
        .filter(|pull_request| matches_review_settings(pull_request, &review_settings))
        .collect();
    developer_review::attach_review_states(pool, &mut values)
        .await
        .map_err(|_| {
            command_error(
                "database",
                "Pull request review state database operation failed",
                false,
            )
        })?;
    values.sort_by(compare_pull_requests);
    Ok(MyPullRequestsPageDto {
        total: Some(values.len() as u64),
        values,
        next_start: None,
        has_more: false,
        last_updated_at: cache.last_updated_at,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCommentRequest {
    pub integration_id: String,
    pub project_key: String,
    pub repository_slug: String,
    pub pull_request_id: String,
    pub latest_commit: Option<String>,
    pub file: String,
    pub line: Option<i64>,
    pub comment: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDecisionRequest {
    pub integration_id: String,
    pub project_key: String,
    pub repository_slug: String,
    pub pull_request_id: String,
    pub latest_commit: Option<String>,
    pub action: PullRequestDecisionAction,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestDecisionAction {
    Approve,
    NeedsWork,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCommentStatus {
    pub comment_id: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDecisionStatus {
    pub integration_id: String,
    pub pull_request_id: String,
    pub my_decision: String,
}

struct BitbucketActionContext {
    client: BitbucketDcClient,
    current_user_slug: String,
}

async fn bitbucket_action_context(
    pool: &SqlitePool,
    integration_id: &str,
) -> Result<BitbucketActionContext, DeveloperCommandError> {
    let integrations = repositories::list_integrations(pool).await.map_err(|_| {
        command_error(
            "database",
            "Bitbucket integration database operation failed",
            false,
        )
    })?;
    let integration = integrations
        .iter()
        .find(|value| {
            value.id == integration_id
                && value.kind == IntegrationKind::Bitbucket
                && value.enabled
                && value.health_status == IntegrationHealthStatus::Working
        })
        .ok_or_else(|| {
            command_error(
                "integration_unavailable",
                "A working Bitbucket integration is required for this action",
                false,
            )
        })?;
    let current_user_slug = integration.account_key.trim().to_owned();
    let current_user_slug = if current_user_slug.is_empty() {
        integration
            .account_display_name
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_owned()
    } else {
        current_user_slug
    };
    if current_user_slug.is_empty() {
        return Err(command_error(
            "missing_account_identity",
            "Bitbucket account identity is required for pull request actions",
            false,
        ));
    }

    #[cfg(debug_assertions)]
    let keyring = DevCredentialStore::from_integrations(std::iter::once((
        integration.credential_ref.clone(),
        integration.kind,
    )));
    #[cfg(not(debug_assertions))]
    let keyring = OsKeyring::new(KEYRING_SERVICE);
    let secret = keyring.load(&integration.credential_ref).map_err(|_| {
        command_error(
            "missing_credential",
            "Bitbucket credential is missing",
            false,
        )
    })?;
    if secret.trim().is_empty() {
        return Err(command_error(
            "missing_credential",
            "Bitbucket credential is missing",
            false,
        ));
    }
    let http = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            command_error(
                "transport_unavailable",
                "Bitbucket transport is unavailable",
                true,
            )
        })?;
    let client =
        BitbucketDcClient::with_bearer_token_and_client(&integration.base_url, secret, http)
            .map_err(map_error)?;
    Ok(BitbucketActionContext {
        client,
        current_user_slug,
    })
}

fn validate_action_request(
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    latest_commit: Option<&str>,
) -> Result<u64, DeveloperCommandError> {
    if integration_id.trim().is_empty()
        || project_key.trim().is_empty()
        || repository_slug.trim().is_empty()
        || pull_request_id.trim().is_empty()
    {
        return Err(command_error(
            "invalid_input",
            "Integration and pull request identifiers are required",
            false,
        ));
    }
    if latest_commit.is_none_or(|value| value.trim().is_empty()) {
        return Err(command_error(
            "invalid_input",
            "The pull request latest commit is required for this action",
            false,
        ));
    }
    pull_request_id
        .parse::<u64>()
        .map_err(|_| command_error("invalid_input", "Pull request id is invalid", false))
}

struct CurrentPullRequestRevision {
    source_commit: String,
    target_commit: Option<String>,
}

async fn validate_current_pull_request(
    client: &BitbucketDcClient,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: u64,
    latest_commit: &str,
) -> Result<CurrentPullRequestRevision, DeveloperCommandError> {
    let current_pull_request = client
        .get_pull_request(project_key, repository_slug, pull_request_id)
        .await
        .map_err(map_error)?;
    if !current_pull_request.open || !current_pull_request.state.eq_ignore_ascii_case("OPEN") {
        return Err(command_error(
            "pull_request_unavailable",
            "Pull request is no longer open",
            false,
        ));
    }
    if current_pull_request.from_ref.latest_commit.as_deref() != Some(latest_commit) {
        return Err(command_error(
            "pull_request_changed",
            "Pull request changed since it was loaded; refresh the list and try again",
            false,
        ));
    }
    Ok(CurrentPullRequestRevision {
        source_commit: latest_commit.to_owned(),
        target_commit: current_pull_request.to_ref.latest_commit,
    })
}

fn validated_comment_text(
    file: &str,
    line: Option<i64>,
    comment: &str,
) -> Result<String, DeveloperCommandError> {
    let file = file.trim();
    let comment = comment.trim();
    if file.is_empty()
        || comment.is_empty()
        || file.chars().any(char::is_control)
        || line.is_some_and(|value| value <= 0)
    {
        return Err(command_error(
            "invalid_input",
            "Comment location and text are required",
            false,
        ));
    }
    if file.chars().count() > 1_000 || comment.chars().count() > 20_000 {
        return Err(command_error("invalid_input", "Comment is too long", false));
    }
    Ok(comment.to_owned())
}

pub async fn publish_pull_request_comment(
    pool: &SqlitePool,
    request: PullRequestCommentRequest,
) -> Result<PullRequestCommentStatus, DeveloperCommandError> {
    let pull_request_id = validate_action_request(
        &request.integration_id,
        &request.project_key,
        &request.repository_slug,
        &request.pull_request_id,
        request.latest_commit.as_deref(),
    )?;
    let text = validated_comment_text(&request.file, request.line, &request.comment)?;
    let context = bitbucket_action_context(pool, &request.integration_id).await?;
    let revision = validate_current_pull_request(
        &context.client,
        &request.project_key,
        &request.repository_slug,
        pull_request_id,
        request
            .latest_commit
            .as_deref()
            .expect("validated latest commit"),
    )
    .await?;
    let target_commit = revision.target_commit.ok_or_else(|| {
        command_error(
            "pull_request_unavailable",
            "Pull request target commit is unavailable for an inline comment",
            false,
        )
    })?;
    let comment = context
        .client
        .publish_pull_request_comment(
            &request.project_key,
            &request.repository_slug,
            pull_request_id,
            BitbucketInlineComment {
                text: &text,
                from_hash: &target_commit,
                to_hash: &revision.source_commit,
                path: request.file.trim(),
                line: request.line,
            },
        )
        .await
        .map_err(map_error)?;
    update_cached_comment_count(
        pool,
        &request.integration_id,
        &request.project_key,
        &request.repository_slug,
        &request.pull_request_id,
    )
    .await;
    Ok(PullRequestCommentStatus {
        comment_id: comment.id,
    })
}

pub async fn set_pull_request_decision(
    pool: &SqlitePool,
    request: PullRequestDecisionRequest,
) -> Result<PullRequestDecisionStatus, DeveloperCommandError> {
    let pull_request_id = validate_action_request(
        &request.integration_id,
        &request.project_key,
        &request.repository_slug,
        &request.pull_request_id,
        request.latest_commit.as_deref(),
    )?;
    let (status, my_decision) = match request.action {
        PullRequestDecisionAction::Approve => ("APPROVED", "approved"),
        PullRequestDecisionAction::NeedsWork => ("NEEDS_WORK", "needs_work"),
    };
    let context = bitbucket_action_context(pool, &request.integration_id).await?;
    validate_current_pull_request(
        &context.client,
        &request.project_key,
        &request.repository_slug,
        pull_request_id,
        request
            .latest_commit
            .as_deref()
            .expect("validated latest commit"),
    )
    .await?;
    context
        .client
        .set_pull_request_participant_status(
            &request.project_key,
            &request.repository_slug,
            pull_request_id,
            &context.current_user_slug,
            status,
        )
        .await
        .map_err(map_error)?;
    update_cached_decision(
        pool,
        &request.integration_id,
        &request.project_key,
        &request.repository_slug,
        &request.pull_request_id,
        my_decision,
    )
    .await;
    Ok(PullRequestDecisionStatus {
        integration_id: request.integration_id,
        pull_request_id: request.pull_request_id,
        my_decision: my_decision.to_owned(),
    })
}

async fn update_cached_decision(
    pool: &SqlitePool,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    my_decision: &str,
) {
    let _state_guard = pull_request_state_lock().lock().await;
    let Ok(mut cache) = load_pull_request_cache(pool).await else {
        return;
    };
    for pull_request in &mut cache.values {
        if pull_request.integration_id == integration_id
            && pull_request.project_key == project_key
            && pull_request.repository_slug == repository_slug
            && pull_request.pull_request_id == pull_request_id
        {
            pull_request.my_decision = my_decision.to_owned();
        }
    }
    let _ = save_pull_request_cache(pool, &cache).await;
}

async fn update_cached_comment_count(
    pool: &SqlitePool,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
) {
    let _state_guard = pull_request_state_lock().lock().await;
    let Ok(mut cache) = load_pull_request_cache(pool).await else {
        return;
    };
    for pull_request in &mut cache.values {
        if pull_request.integration_id == integration_id
            && pull_request.project_key == project_key
            && pull_request.repository_slug == repository_slug
            && pull_request.pull_request_id == pull_request_id
        {
            pull_request.review_summary.comments =
                pull_request.review_summary.comments.saturating_add(1);
        }
    }
    let _ = save_pull_request_cache(pool, &cache).await;
}

fn compare_pull_requests(left: &MyPullRequestDto, right: &MyPullRequestDto) -> std::cmp::Ordering {
    activity_rank(left.activity)
        .cmp(&activity_rank(right.activity))
        .then_with(|| right.updated_date.cmp(&left.updated_date))
        .then_with(|| left.repository_slug.cmp(&right.repository_slug))
        .then_with(|| left.pull_request_id.cmp(&right.pull_request_id))
}

fn should_notify_pull_request(
    previous: Option<&PullRequestActivitySnapshot>,
    latest_commit: Option<&String>,
    first_sync: bool,
) -> bool {
    !first_sync
        && (previous.is_none()
            || (latest_commit.is_some()
                && previous.and_then(|value| value.latest_commit.as_ref()) != latest_commit))
}

pub(crate) fn current_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub async fn mark_pull_request_read(
    pool: &SqlitePool,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    latest_commit: Option<String>,
) -> Result<PullRequestActivityStatus, DeveloperCommandError> {
    if integration_id.trim().is_empty()
        || project_key.trim().is_empty()
        || repository_slug.trim().is_empty()
        || pull_request_id.trim().is_empty()
    {
        return Err(command_error(
            "invalid_input",
            "Integration and pull request identifiers are required",
            false,
        ));
    }
    let _state_guard = pull_request_state_lock().lock().await;
    let state_key = pull_request_state_key(project_key, repository_slug, pull_request_id);
    let cached_latest_commit = if latest_commit.is_none() {
        deduplicate_cached_pull_requests(load_pull_request_cache(pool).await?.values)
            .into_iter()
            .find(|pull_request| {
                pull_request.integration_id == integration_id
                    && pull_request.project_key == project_key
                    && pull_request.repository_slug == repository_slug
                    && pull_request.pull_request_id == pull_request_id
            })
            .and_then(|pull_request| pull_request.latest_commit)
    } else {
        None
    };
    let latest_commit = latest_commit.or(cached_latest_commit);
    let mut state = load_pull_request_activity_state(pool).await?;
    let integration = state
        .integrations
        .entry(integration_id.to_owned())
        .or_default();
    let legacy_snapshot = integration.pull_requests.remove(pull_request_id);
    if !integration.pull_requests.contains_key(&state_key) {
        if let Some(legacy_snapshot) = legacy_snapshot {
            integration
                .pull_requests
                .insert(state_key.clone(), legacy_snapshot);
        }
    }
    let snapshot = integration
        .pull_requests
        .entry(state_key)
        .or_insert_with(|| PullRequestActivitySnapshot {
            latest_commit: latest_commit.clone(),
            activity: PullRequestActivity::Read,
            auto_review_completed: false,
        });
    if latest_commit.is_some() {
        snapshot.latest_commit = latest_commit;
    }
    snapshot.activity = PullRequestActivity::Read;
    save_pull_request_activity_state(pool, &state).await?;
    Ok(PullRequestActivityStatus {
        integration_id: integration_id.to_owned(),
        pull_request_id: pull_request_id.to_owned(),
        activity: PullRequestActivity::Read,
    })
}

pub async fn mark_all_pull_requests_read(
    pool: &SqlitePool,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    let _state_guard = pull_request_state_lock().lock().await;
    let cache = load_pull_request_cache(pool).await?;
    let mut state = load_pull_request_activity_state(pool).await?;
    let mut marked_count = 0_u64;
    for integration in state.integrations.values_mut() {
        for snapshot in integration.pull_requests.values_mut() {
            if snapshot.activity != PullRequestActivity::Read {
                marked_count = marked_count.saturating_add(1);
            }
            snapshot.activity = PullRequestActivity::Read;
        }
    }
    for pull_request in deduplicate_cached_pull_requests(cache.values) {
        let state_key = pull_request_state_key(
            &pull_request.project_key,
            &pull_request.repository_slug,
            &pull_request.pull_request_id,
        );
        let integration = state
            .integrations
            .entry(pull_request.integration_id)
            .or_default();
        let legacy_snapshot = integration
            .pull_requests
            .remove(&pull_request.pull_request_id);
        let snapshot = if integration.pull_requests.contains_key(&state_key) {
            integration
                .pull_requests
                .get_mut(&state_key)
                .expect("checked above")
        } else {
            integration
                .pull_requests
                .entry(state_key)
                .or_insert(legacy_snapshot.unwrap_or(PullRequestActivitySnapshot {
                    latest_commit: None,
                    activity: PullRequestActivity::Read,
                    auto_review_completed: false,
                }))
        };
        if snapshot.activity != PullRequestActivity::Read {
            marked_count = marked_count.saturating_add(1);
        }
        if pull_request.latest_commit.is_some() {
            snapshot.latest_commit = pull_request.latest_commit;
        }
        snapshot.activity = PullRequestActivity::Read;
    }
    save_pull_request_activity_state(pool, &state).await?;
    Ok(PullRequestReadAllStatus { marked_count })
}

pub async fn mark_auto_review_completed(
    pool: &SqlitePool,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    latest_commit: &str,
) -> Result<bool, DeveloperCommandError> {
    if latest_commit.trim().is_empty() {
        return Ok(false);
    }
    let _state_guard = pull_request_state_lock().lock().await;
    let mut state = load_pull_request_activity_state(pool).await?;
    let state_key = pull_request_state_key(project_key, repository_slug, pull_request_id);
    let Some(integration) = state.integrations.get_mut(integration_id) else {
        return Ok(false);
    };
    let Some(snapshot) = integration.pull_requests.get_mut(&state_key) else {
        return Ok(false);
    };
    if snapshot.latest_commit.as_deref() != Some(latest_commit) {
        return Ok(false);
    }
    snapshot.auto_review_completed = true;
    save_pull_request_activity_state(pool, &state).await?;
    Ok(true)
}

async fn load_pull_request_activity_state(
    pool: &SqlitePool,
) -> Result<PullRequestActivityState, DeveloperCommandError> {
    let value = repositories::get_setting(pool, PULL_REQUEST_ACTIVITY_SETTING_KEY)
        .await
        .map_err(map_activity_database_error)?;
    value
        .map(|value| {
            serde_json::from_str(&value).map_err(|_| {
                command_error(
                    "invalid_settings",
                    "Saved pull request activity state is invalid",
                    false,
                )
            })
        })
        .transpose()
        .map(|state| state.unwrap_or_default())
}

async fn save_pull_request_activity_state(
    pool: &SqlitePool,
    state: &PullRequestActivityState,
) -> Result<(), DeveloperCommandError> {
    let value = serde_json::to_string(state).map_err(|_| {
        command_error(
            "database",
            "Pull request activity state could not be serialized",
            false,
        )
    })?;
    repositories::upsert_setting(
        pool,
        PULL_REQUEST_ACTIVITY_SETTING_KEY,
        &value,
        PULL_REQUEST_ACTIVITY_SCHEMA_VERSION,
    )
    .await
    .map_err(map_activity_database_error)
}

async fn load_pull_request_cache(
    pool: &SqlitePool,
) -> Result<PullRequestCache, DeveloperCommandError> {
    let value = repositories::get_setting(pool, PULL_REQUEST_CACHE_SETTING_KEY)
        .await
        .map_err(map_cache_database_error)?;
    let Some(value) = value else {
        return Ok(PullRequestCache {
            values: Vec::new(),
            last_updated_at: None,
        });
    };
    let (cache, had_embedded_review_state) = parse_pull_request_cache(&value).map_err(|_| {
        command_error(
            "invalid_settings",
            "Saved pull request cache is invalid",
            false,
        )
    })?;
    if had_embedded_review_state {
        save_pull_request_cache(pool, &cache).await?;
    }
    Ok(cache)
}

fn parse_pull_request_cache(value: &str) -> Result<(PullRequestCache, bool), serde_json::Error> {
    if let Ok(cache) = serde_json::from_str::<PullRequestCache>(value) {
        return Ok((cache, false));
    }
    let mut raw: serde_json::Value = serde_json::from_str(value)?;
    let mut removed_review_state = false;
    if let Some(values) = raw
        .get_mut("values")
        .and_then(serde_json::Value::as_array_mut)
    {
        for item in values {
            if let Some(object) = item.as_object_mut() {
                removed_review_state |= object.remove("review").is_some();
            }
        }
    }
    let cache = serde_json::from_value(raw)?;
    Ok((cache, removed_review_state))
}

async fn save_pull_request_cache(
    pool: &SqlitePool,
    cache: &PullRequestCache,
) -> Result<(), DeveloperCommandError> {
    let mut storage_cache = cache.clone();
    for pull_request in &mut storage_cache.values {
        pull_request.review = None;
    }
    let value = serde_json::to_string(&storage_cache).map_err(|_| {
        command_error(
            "database",
            "Pull request cache could not be serialized",
            false,
        )
    })?;
    repositories::upsert_setting(
        pool,
        PULL_REQUEST_CACHE_SETTING_KEY,
        &value,
        PULL_REQUEST_CACHE_SCHEMA_VERSION,
    )
    .await
    .map_err(map_cache_database_error)
}

fn map_activity_database_error(_: sqlx::Error) -> DeveloperCommandError {
    command_error(
        "database",
        "Pull request activity database operation failed",
        false,
    )
}

fn map_cache_database_error(_: sqlx::Error) -> DeveloperCommandError {
    command_error(
        "database",
        "Pull request cache database operation failed",
        false,
    )
}

pub(crate) fn pull_request_state_key(
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
) -> String {
    format!("{project_key}/{repository_slug}/{pull_request_id}")
}

pub(crate) fn dashboard_repository_identity(
    pull_request: &BitbucketDashboardPullRequest,
) -> (String, String) {
    let repository = pull_request.from_ref.repository.as_ref();
    let repository_slug = repository
        .and_then(|value| value.slug.clone())
        .unwrap_or_else(|| "unknown".into());
    let project_key = repository
        .and_then(|value| value.project.as_ref())
        .map(|value| value.key.clone())
        .unwrap_or_else(|| "unknown".into());
    (project_key, repository_slug)
}

fn deduplicate_cached_pull_requests(values: Vec<MyPullRequestDto>) -> Vec<MyPullRequestDto> {
    let mut unique = HashMap::new();
    for pull_request in values {
        let key = pull_request_key(&pull_request);
        let should_replace = unique.get(&key).is_none_or(|current: &MyPullRequestDto| {
            pull_request.updated_date.unwrap_or(i64::MIN) > current.updated_date.unwrap_or(i64::MIN)
        });
        if should_replace {
            unique.insert(key, pull_request);
        }
    }
    unique.into_values().collect()
}

fn pull_request_key(pull_request: &MyPullRequestDto) -> String {
    format!(
        "{}:{}:{}:{}",
        pull_request.integration_id,
        pull_request.project_key,
        pull_request.repository_slug,
        pull_request.pull_request_id
    )
}

pub(crate) fn deduplicate_pull_requests(
    values: Vec<BitbucketDashboardPullRequest>,
) -> Vec<BitbucketDashboardPullRequest> {
    let mut unique = HashMap::new();
    for pull_request in values {
        let (project_key, repository_slug) = dashboard_repository_identity(&pull_request);
        let key = (project_key, repository_slug, pull_request.id);
        let should_replace =
            unique
                .get(&key)
                .is_none_or(|current: &BitbucketDashboardPullRequest| {
                    pull_request.updated_date.unwrap_or(i64::MIN)
                        > current.updated_date.unwrap_or(i64::MIN)
                });
        if should_replace {
            unique.insert(key, pull_request);
        }
    }
    unique.into_values().collect()
}

#[cfg(test)]
fn record_pull_request_snapshot(
    state: &mut PullRequestActivityState,
    integration_id: &str,
    pull_request_id: &str,
    latest_commit: Option<String>,
    first_sync: bool,
) -> PullRequestActivity {
    record_pull_request_snapshot_with_identity(
        state,
        integration_id,
        "unknown",
        "unknown",
        pull_request_id,
        latest_commit,
        first_sync,
    )
}

fn record_pull_request_snapshot_with_identity(
    state: &mut PullRequestActivityState,
    integration_id: &str,
    project_key: &str,
    repository_slug: &str,
    pull_request_id: &str,
    latest_commit: Option<String>,
    first_sync: bool,
) -> PullRequestActivity {
    let integration = state
        .integrations
        .entry(integration_id.to_owned())
        .or_default();
    let state_key = pull_request_state_key(project_key, repository_slug, pull_request_id);
    let previous = integration
        .pull_requests
        .get(&state_key)
        .or_else(|| integration.pull_requests.get(pull_request_id))
        .cloned();
    let activity = if first_sync {
        PullRequestActivity::Read
    } else if let Some(previous) = &previous {
        if latest_commit.is_none() || previous.latest_commit == latest_commit {
            previous.activity
        } else {
            PullRequestActivity::Updated
        }
    } else {
        PullRequestActivity::New
    };
    integration.pull_requests.remove(pull_request_id);
    let effective_latest_commit = latest_commit.or_else(|| {
        previous
            .as_ref()
            .and_then(|snapshot| snapshot.latest_commit.clone())
    });
    let auto_review_completed = previous.as_ref().is_some_and(|snapshot| {
        snapshot.latest_commit.as_ref() == effective_latest_commit.as_ref()
            && snapshot.auto_review_completed
    });
    integration.pull_requests.insert(
        state_key,
        PullRequestActivitySnapshot {
            latest_commit: effective_latest_commit,
            activity,
            auto_review_completed,
        },
    );
    activity
}

const fn activity_rank(activity: PullRequestActivity) -> u8 {
    match activity {
        PullRequestActivity::New => 0,
        PullRequestActivity::Updated => 1,
        PullRequestActivity::Read => 2,
    }
}

fn matches_review_settings(
    pull_request: &MyPullRequestDto,
    settings: &PullRequestReviewSettings,
) -> bool {
    let repository_candidates = [
        pull_request.project_key.as_str(),
        pull_request.repository_slug.as_str(),
        pull_request.repository_name.as_str(),
    ];
    let repository_whitelist_matches = settings.repository_whitelist.iter().any(|value| {
        repository_candidates
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(value.trim()))
    });
    let creator_whitelist_matches = settings.creator_whitelist.iter().any(|value| {
        pull_request
            .author_display_name
            .eq_ignore_ascii_case(value.trim())
    });
    let repository_blacklist_matches = settings.repository_blacklist.iter().any(|value| {
        repository_candidates
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(value.trim()))
    });
    let creator_blacklist_matches = settings.creator_blacklist.iter().any(|value| {
        pull_request
            .author_display_name
            .eq_ignore_ascii_case(value.trim())
    });
    let whitelist_configured =
        !settings.repository_whitelist.is_empty() || !settings.creator_whitelist.is_empty();
    if whitelist_configured {
        repository_whitelist_matches || creator_whitelist_matches
    } else {
        !(repository_blacklist_matches || creator_blacklist_matches)
    }
}

fn safe_avatar_url(user: &BitbucketUser) -> Option<String> {
    user.links
        .as_ref()?
        .avatar
        .as_ref()?
        .iter()
        .find_map(|link| {
            let mut url = Url::parse(&link.href).ok()?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return None;
            }
            url.set_query(None);
            url.set_fragment(None);
            Some(url.to_string())
        })
}

pub(crate) fn pull_request_dto(
    integration_id: &str,
    account_key: &str,
    account_display_name: Option<&str>,
    pull_request: BitbucketDashboardPullRequest,
) -> MyPullRequestDto {
    let repository = pull_request.from_ref.repository.as_ref();
    let repository_slug = repository
        .and_then(|value| value.slug.clone())
        .unwrap_or_else(|| "unknown".into());
    let repository_name = repository
        .and_then(|value| value.name.clone())
        .unwrap_or_else(|| repository_slug.clone());
    let project_key = repository
        .and_then(|value| value.project.as_ref())
        .map(|value| value.key.clone())
        .unwrap_or_else(|| "unknown".into());
    let url = pull_request
        .links
        .as_ref()
        .and_then(|value| value.self_link.as_ref())
        .and_then(|value| value.first())
        .map(|value| value.href.clone());
    let author = pull_request.author.map(|author| match author {
        BitbucketPullRequestAuthor::Participant(value) => value.user,
        BitbucketPullRequestAuthor::User(value) => value,
    });
    let author_avatar_url = author.as_ref().and_then(safe_avatar_url);
    let author_display_name = author
        .and_then(|value| value.display_name.or(value.name).or(value.slug))
        .unwrap_or_else(|| "Unknown author".into());

    MyPullRequestDto {
        integration_id: integration_id.into(),
        pull_request_id: pull_request.id.to_string(),
        title: pull_request.title,
        state: pull_request.state,
        repository_slug,
        repository_name,
        project_key,
        source_branch: pull_request.from_ref.display_id,
        target_branch: pull_request.to_ref.display_id,
        author_display_name,
        author_avatar_url,
        latest_commit: pull_request.from_ref.latest_commit,
        updated_date: pull_request.updated_date,
        url,
        my_decision: my_decision(&pull_request.reviewers, account_key, account_display_name),
        review_summary: reviewer_summary(&pull_request.reviewers),
        needs_action: false,
        activity: PullRequestActivity::Read,
        review: None,
    }
}

pub(crate) fn reviewer_summary(reviewers: &[BitbucketParticipant]) -> PullRequestReviewSummaryDto {
    let mut summary = PullRequestReviewSummaryDto::default();
    for reviewer in reviewers
        .iter()
        .filter(|value| value.role.eq_ignore_ascii_case("REVIEWER"))
    {
        if reviewer.approved == Some(true)
            || reviewer
                .status
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("APPROVED"))
        {
            summary.approved = summary.approved.saturating_add(1);
        } else if participant_needs_work(reviewer) {
            summary.needs_work = summary.needs_work.saturating_add(1);
        }
    }
    summary
}

pub(crate) fn merge_reviewer_summaries(
    primary: PullRequestReviewSummaryDto,
    fallback: PullRequestReviewSummaryDto,
) -> PullRequestReviewSummaryDto {
    PullRequestReviewSummaryDto {
        approved: primary.approved.max(fallback.approved),
        needs_work: primary.needs_work.max(fallback.needs_work),
        comments: primary.comments.max(fallback.comments),
    }
}

fn participant_needs_work(participant: &BitbucketParticipant) -> bool {
    participant.status.as_deref().is_some_and(|value| {
        matches_ignore_case(
            value,
            &[
                "NEEDS_WORK",
                "NEEDS WORK",
                "REQUEST_CHANGES",
                "REQUESTED_CHANGES",
                "CHANGES_REQUESTED",
            ],
        )
    })
}

fn matches_ignore_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}
fn my_decision(
    reviewers: &[BitbucketParticipant],
    account_key: &str,
    account_display_name: Option<&str>,
) -> String {
    let reviewer = reviewers
        .iter()
        .find(|value| user_matches(&value.user, account_key, account_display_name))
        .or_else(|| (account_key.trim().is_empty() && reviewers.len() == 1).then(|| &reviewers[0]));
    let Some(reviewer) = reviewer else {
        return "not_reviewed".into();
    };
    if reviewer.approved == Some(true)
        || reviewer
            .status
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("APPROVED"))
    {
        "approved".into()
    } else if participant_needs_work(reviewer) {
        "needs_work".into()
    } else {
        "not_reviewed".into()
    }
}

fn user_matches(
    user: &BitbucketUser,
    account_key: &str,
    account_display_name: Option<&str>,
) -> bool {
    let candidates = [
        user.name.as_deref(),
        user.slug.as_deref(),
        user.display_name.as_deref(),
    ];
    candidates.into_iter().flatten().any(|candidate| {
        candidate.eq_ignore_ascii_case(account_key.trim())
            || account_display_name
                .is_some_and(|display_name| candidate.eq_ignore_ascii_case(display_name.trim()))
    })
}

pub(crate) fn command_error(code: &str, message: &str, retryable: bool) -> DeveloperCommandError {
    DeveloperCommandError {
        code: code.into(),
        message: message.into(),
        retryable,
    }
}

pub(crate) fn map_error(error: BitbucketDcError) -> DeveloperCommandError {
    match error {
        BitbucketDcError::InvalidBaseUrl => {
            command_error("invalid_metadata", "Bitbucket base URL is invalid", false)
        }
        BitbucketDcError::InvalidRequest => {
            command_error("invalid_input", "Bitbucket request is invalid", false)
        }
        BitbucketDcError::InvalidCredentials => command_error(
            "missing_credential",
            "Bitbucket credential is missing",
            false,
        ),
        BitbucketDcError::Transport => command_error(
            "transport_unavailable",
            "Bitbucket transport is unavailable",
            true,
        ),
        BitbucketDcError::Http {
            status,
            kind: BitbucketHttpErrorKind::Authentication,
            ..
        } => command_error(
            "authentication_required",
            &format!("Bitbucket authentication is required (HTTP {status})"),
            false,
        ),
        BitbucketDcError::Http {
            status,
            kind: BitbucketHttpErrorKind::PermissionDenied,
            ..
        } => command_error(
            "permission_denied",
            &format!("Bitbucket pull request permission denied (HTTP {status})"),
            false,
        ),
        BitbucketDcError::Http {
            status,
            kind: BitbucketHttpErrorKind::RateLimited,
            ..
        } => command_error(
            "rate_limited",
            &format!("Bitbucket rate limit exceeded (HTTP {status})"),
            true,
        ),
        BitbucketDcError::Http {
            status,
            kind: BitbucketHttpErrorKind::Client,
            retryable,
            detail,
            ..
        } => command_error(
            "remote_error",
            &match detail {
                Some(detail) => {
                    format!("Bitbucket pull request request failed (HTTP {status}): {detail}")
                }
                None => format!("Bitbucket pull request request failed (HTTP {status})"),
            },
            retryable,
        ),
        BitbucketDcError::Http {
            status, retryable, ..
        } => command_error(
            "remote_error",
            &format!("Bitbucket pull request request failed (HTTP {status})"),
            retryable,
        ),
        BitbucketDcError::InvalidResponse => command_error(
            "invalid_response",
            "Bitbucket returned an invalid response",
            false,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        deduplicate_pull_requests, get_pull_request_review_settings, mark_all_pull_requests_read,
        mark_pull_request_read, matches_review_settings, merge_reviewer_summaries, my_decision,
        parse_pull_request_cache, record_pull_request_snapshot,
        record_pull_request_snapshot_with_identity, safe_avatar_url,
        save_pull_request_activity_state, save_pull_request_review_settings,
        should_notify_pull_request, validated_comment_text, BitbucketDashboardPullRequest,
        MyPullRequestDto, PullRequestActivity, PullRequestActivitySnapshot,
        PullRequestActivityState, PullRequestReviewSettings, PullRequestReviewSummaryDto,
    };
    use crate::infrastructure::db::open_database;
    use crate::infrastructure::integrations::bitbucket_dc::models::{
        BitbucketLink, BitbucketLinks, BitbucketParticipant, BitbucketRef, BitbucketUser,
    };

    #[test]
    fn validates_inline_comment_text_without_injecting_location_prefix() {
        assert_eq!(
            validated_comment_text("src/lib.rs", Some(42), "  Keep this guard. ").unwrap(),
            "Keep this guard."
        );
        assert!(validated_comment_text("src/lib.rs", Some(0), "Keep this guard.").is_err());
    }

    #[test]
    fn accepts_cache_with_legacy_embedded_review_state() {
        let (cache, had_embedded_review_state) = parse_pull_request_cache(
            r#"{"values":[{"integrationId":"bitbucket-1","pullRequestId":"7","title":"Review","state":"OPEN","repositorySlug":"repo","repositoryName":"Repo","projectKey":"DEMO","sourceBranch":"feature","targetBranch":"main","authorDisplayName":"Test Author A","updatedDate":1,"url":"https://bitbucket.example/projects/DEMO/repos/repo/pull-requests/7","myDecision":"not_reviewed","authorAvatarUrl":null,"latestCommit":"commit-7","activity":"read","review":{"runId":"run-1","status":"completed","reviewedCommit":"commit-7","result":{"verdict":"needs_changes","summary":"Legacy","comments":[{"priority":"important","file":"src/lib.rs","line":1,"comment":"Fix"}]},"error":null,"startedAt":1,"finishedAt":2}}],"lastUpdatedAt":1}"#,
        )
        .unwrap();
        assert!(had_embedded_review_state);
        assert_eq!(cache.values.len(), 1);
        assert!(cache.values[0].review.is_none());
    }

    #[test]
    fn deduplicates_pull_requests_before_activity_tracking() {
        let make_pull_request =
            |id: u64, updated_date: i64, latest_commit: &str| BitbucketDashboardPullRequest {
                id,
                version: 1,
                title: "Example authorization change".into(),
                state: "OPEN".into(),
                draft: false,
                open: true,
                closed: false,
                created_date: None,
                updated_date: Some(updated_date),
                from_ref: BitbucketRef {
                    id: "refs/heads/feature".into(),
                    display_id: "feature".into(),
                    latest_commit: Some(latest_commit.into()),
                    repository: None,
                },
                to_ref: BitbucketRef {
                    id: "refs/heads/master".into(),
                    display_id: "master".into(),
                    latest_commit: None,
                    repository: None,
                },
                author: None,
                reviewers: Vec::new(),
                links: None,
            };
        let values = deduplicate_pull_requests(vec![
            make_pull_request(574, 100, "old-commit"),
            make_pull_request(574, 200, "new-commit"),
            make_pull_request(575, 150, "other-commit"),
        ]);

        assert_eq!(values.len(), 2);
        let selected = values.iter().find(|value| value.id == 574).unwrap();
        assert_eq!(selected.updated_date, Some(200));
        assert_eq!(
            selected.from_ref.latest_commit.as_deref(),
            Some("new-commit")
        );
        assert!(values.iter().any(|value| value.id == 575));
    }

    #[test]
    fn activity_state_is_scoped_by_project_repository_and_number() {
        let mut state = PullRequestActivityState::default();
        assert_eq!(
            record_pull_request_snapshot_with_identity(
                &mut state,
                "integration-a",
                "DEMO",
                "repo-a",
                "7",
                Some("commit-a".into()),
                false,
            ),
            PullRequestActivity::New
        );
        assert_eq!(
            record_pull_request_snapshot_with_identity(
                &mut state,
                "integration-a",
                "DEMO",
                "repo-b",
                "7",
                Some("commit-b".into()),
                false,
            ),
            PullRequestActivity::New
        );
        assert_eq!(state.integrations["integration-a"].pull_requests.len(), 2);
    }

    #[test]
    fn notifies_only_for_new_pull_request_or_new_commit() {
        let commit = "commit-1".to_owned();
        let previous = PullRequestActivitySnapshot {
            latest_commit: Some(commit.clone()),
            activity: PullRequestActivity::Read,
            auto_review_completed: false,
        };
        assert!(!should_notify_pull_request(None, Some(&commit), true));
        assert!(should_notify_pull_request(None, Some(&commit), false));
        assert!(!should_notify_pull_request(
            Some(&previous),
            Some(&commit),
            false
        ));
        assert!(should_notify_pull_request(
            Some(&previous),
            Some(&"commit-2".to_owned()),
            false
        ));
        assert!(!should_notify_pull_request(Some(&previous), None, false));
    }

    #[test]
    fn maps_my_review_decisions_from_a_server_participant() {
        let user = BitbucketUser {
            name: Some("test-author-a".into()),
            display_name: Some("Test Author A".into()),
            email_address: None,
            id: None,
            active: Some(true),
            slug: None,
            links: None,
        };
        let reviewer = BitbucketParticipant {
            user,
            role: "REVIEWER".into(),
            approved: Some(true),
            status: Some("APPROVED".into()),
        };
        assert_eq!(my_decision(&[reviewer], "test-author-a", None), "approved");
    }

    #[test]
    fn maps_needs_work_and_unreviewed_server_statuses() {
        let user = BitbucketUser {
            name: Some("test-author-a".into()),
            display_name: None,
            email_address: None,
            id: None,
            active: Some(true),
            slug: None,
            links: None,
        };
        let needs_work = BitbucketParticipant {
            user: user.clone(),
            role: "REVIEWER".into(),
            approved: Some(false),
            status: Some("NEEDS_WORK".into()),
        };
        let unreviewed = BitbucketParticipant {
            user,
            role: "REVIEWER".into(),
            approved: Some(false),
            status: Some("UNAPPROVED".into()),
        };
        assert_eq!(
            my_decision(&[needs_work], "test-author-a", None),
            "needs_work"
        );
        assert_eq!(
            my_decision(&[unreviewed], "test-author-a", None),
            "not_reviewed"
        );
        assert_eq!(my_decision(&[], "test-author-a", None), "not_reviewed");
    }

    #[test]
    fn merges_reviewer_counters_when_details_omit_statuses() {
        let merged = merge_reviewer_summaries(
            PullRequestReviewSummaryDto {
                approved: 0,
                needs_work: 0,
                comments: 0,
            },
            PullRequestReviewSummaryDto {
                approved: 2,
                needs_work: 1,
                comments: 0,
            },
        );

        assert_eq!(merged.approved, 2);
        assert_eq!(merged.needs_work, 1);
    }

    #[test]
    fn extracts_a_safe_avatar_url_from_bitbucket_user_links() {
        let user = BitbucketUser {
            name: Some("test-author-a".into()),
            display_name: Some("Test Author A".into()),
            email_address: None,
            id: None,
            active: Some(true),
            slug: None,
            links: Some(BitbucketLinks {
                self_link: None,
                avatar: Some(vec![BitbucketLink {
                    href: "https://bitbucket.example/users/test-author-a/avatar.png".into(),
                    name: None,
                }]),
                clone: None,
                commits: None,
                comments: None,
                activity: None,
                overview: None,
                diff: None,
            }),
        };
        assert_eq!(
            safe_avatar_url(&user).as_deref(),
            Some("https://bitbucket.example/users/test-author-a/avatar.png")
        );
    }

    #[tokio::test]
    async fn persists_pull_request_review_settings_in_sqlite() {
        let directory = tempfile::tempdir().unwrap();
        let pool = open_database(&directory.path().join("mework.sqlite"))
            .await
            .unwrap();
        let saved = save_pull_request_review_settings(
            &pool,
            PullRequestReviewSettings {
                repository_blacklist: vec!["SAMPLE/legacy".into()],
                creator_blacklist: vec!["Test Author Blocked".into()],
                repository_whitelist: vec![
                    " DEMO/sample-repository ".into(),
                    "demo/sample-repository".into(),
                ],
                creator_whitelist: vec!["Test Author A".into()],
                auto_review_enabled: true,
                authored_auto_review_enabled: true,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            saved.repository_whitelist,
            vec!["DEMO/sample-repository".to_owned()]
        );
        assert_eq!(
            get_pull_request_review_settings(&pool).await.unwrap(),
            saved
        );
    }

    #[test]
    fn whitelist_takes_precedence_over_blacklist() {
        let pull_request = MyPullRequestDto {
            integration_id: "bitbucket-1".into(),
            pull_request_id: "7".into(),
            title: "Review".into(),
            state: "OPEN".into(),
            repository_slug: "sample-repository".into(),
            repository_name: "Sample Repository".into(),
            project_key: "DEMO".into(),
            source_branch: "feature".into(),
            target_branch: "main".into(),
            author_display_name: "Test Author A".into(),
            updated_date: None,
            url: None,
            my_decision: "not_reviewed".into(),
            author_avatar_url: None,
            latest_commit: Some("commit-7".into()),
            review_summary: PullRequestReviewSummaryDto::default(),
            needs_action: false,
            activity: PullRequestActivity::New,
            review: None,
        };
        assert!(matches_review_settings(
            &pull_request,
            &PullRequestReviewSettings::default()
        ));
        assert!(!matches_review_settings(
            &pull_request,
            &PullRequestReviewSettings {
                creator_blacklist: vec!["Test Author A".into()],
                ..Default::default()
            }
        ));
        assert!(matches_review_settings(
            &pull_request,
            &PullRequestReviewSettings {
                creator_blacklist: vec!["Test Author A".into()],
                creator_whitelist: vec!["Test Author A".into()],
                ..Default::default()
            }
        ));
        assert!(!matches_review_settings(
            &pull_request,
            &PullRequestReviewSettings {
                creator_whitelist: vec!["Test Author B".into()],
                ..Default::default()
            }
        ));
    }

    #[test]
    fn reads_legacy_whitelist_only_settings_with_safe_defaults() {
        let settings: PullRequestReviewSettings = serde_json::from_str(
            r#"{"repositoryWhitelist":["DEMO/sample-repository"],"creatorWhitelist":["Test Author A"]}"#,
        )
        .unwrap();
        assert_eq!(
            settings.repository_whitelist,
            vec!["DEMO/sample-repository"]
        );
        assert!(settings.repository_blacklist.is_empty());
        assert!(settings.creator_blacklist.is_empty());
        assert!(!settings.auto_review_enabled);
        assert!(!settings.authored_auto_review_enabled);
    }

    #[test]
    fn classifies_baselines_new_changes_and_preserves_unread_activity() {
        let mut state = PullRequestActivityState::default();
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "7",
                Some("commit-1".into()),
                true,
            ),
            PullRequestActivity::Read
        );
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "7",
                Some("commit-1".into()),
                false,
            ),
            PullRequestActivity::Read
        );
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "8",
                Some("commit-2".into()),
                false,
            ),
            PullRequestActivity::New
        );
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "8",
                Some("commit-2".into()),
                false,
            ),
            PullRequestActivity::New
        );
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "7",
                Some("commit-3".into()),
                false,
            ),
            PullRequestActivity::Updated
        );
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "7",
                Some("commit-3".into()),
                false,
            ),
            PullRequestActivity::Updated
        );
        state
            .integrations
            .get_mut("integration-a")
            .unwrap()
            .pull_requests
            .get_mut("unknown/unknown/7")
            .unwrap()
            .activity = PullRequestActivity::Read;
        assert_eq!(
            record_pull_request_snapshot(&mut state, "integration-a", "7", None, false),
            PullRequestActivity::Read
        );
        assert_eq!(
            state.integrations["integration-a"].pull_requests["unknown/unknown/7"]
                .latest_commit
                .as_deref(),
            Some("commit-3")
        );
    }

    #[tokio::test]
    async fn mark_read_persists_scoped_activity_status() {
        let directory = tempfile::tempdir().unwrap();
        let pool = open_database(&directory.path().join("mework.sqlite"))
            .await
            .unwrap();
        let mut state = PullRequestActivityState::default();
        assert_eq!(
            record_pull_request_snapshot(
                &mut state,
                "integration-a",
                "7",
                Some("commit-1".into()),
                false,
            ),
            PullRequestActivity::New
        );
        save_pull_request_activity_state(&pool, &state)
            .await
            .unwrap();

        let status = mark_pull_request_read(
            &pool,
            "integration-a",
            "unknown",
            "unknown",
            "7",
            Some("commit-1".into()),
        )
        .await
        .unwrap();
        assert_eq!(status.activity, PullRequestActivity::Read);
        let saved = super::load_pull_request_activity_state(&pool)
            .await
            .unwrap();
        let snapshot = &saved.integrations["integration-a"].pull_requests["unknown/unknown/7"];
        assert_eq!(snapshot.activity, PullRequestActivity::Read);
        assert_eq!(snapshot.latest_commit.as_deref(), Some("commit-1"));
        let mut next_state = saved;
        assert_eq!(
            record_pull_request_snapshot(
                &mut next_state,
                "integration-a",
                "7",
                Some("commit-1".into()),
                false,
            ),
            PullRequestActivity::Read
        );
    }

    #[tokio::test]
    async fn mark_all_read_persists_current_activity_state() {
        let directory = tempfile::tempdir().unwrap();
        let pool = open_database(&directory.path().join("mework.sqlite"))
            .await
            .unwrap();
        let mut state = PullRequestActivityState::default();
        record_pull_request_snapshot(
            &mut state,
            "integration-a",
            "7",
            Some("commit-1".into()),
            false,
        );
        record_pull_request_snapshot(
            &mut state,
            "integration-a",
            "8",
            Some("commit-2".into()),
            false,
        );
        save_pull_request_activity_state(&pool, &state)
            .await
            .unwrap();

        let status = mark_all_pull_requests_read(&pool).await.unwrap();
        assert_eq!(status.marked_count, 2);
        let saved = super::load_pull_request_activity_state(&pool)
            .await
            .unwrap();
        assert!(saved.integrations["integration-a"]
            .pull_requests
            .values()
            .all(|snapshot| snapshot.activity == PullRequestActivity::Read));
    }
}
