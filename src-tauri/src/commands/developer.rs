use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::developer::{
    self, BitbucketRepositoryDto, BitbucketUserDto, DeveloperCommandError, MyPullRequestsPageDto,
    PullRequestActivityStatus, PullRequestReadAllStatus, PullRequestReviewSettings,
};
use crate::application::developer_review::{
    self, PullRequestReviewDto, PullRequestReviewRequest, PullRequestReviewStateRequest,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestReviewPageRequest {
    #[serde(default)]
    pub start: u64,
    #[serde(default = "default_page_size")]
    pub limit: u64,
}

const fn default_page_size() -> u64 {
    100
}

#[tauri::command]
pub async fn bitbucket_my_pull_requests(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    developer::get_cached_my_pull_requests_page(&state, request.limit).await
}

#[tauri::command]
pub async fn bitbucket_my_pull_requests_refresh(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    developer::list_my_pull_requests_page(&state, request.start, request.limit).await
}

#[tauri::command]
pub async fn pull_request_review_start(
    state: State<'_, SqlitePool>,
    app: AppHandle,
    request: PullRequestReviewRequest,
) -> Result<PullRequestReviewDto, DeveloperCommandError> {
    developer_review::start_review(&state, &app, request)
        .await
        .map_err(|message| DeveloperCommandError {
            code: "review_start_failed".to_owned(),
            message,
            retryable: true,
        })
}

#[tauri::command]
pub async fn pull_request_review_state(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewStateRequest,
) -> Result<Option<PullRequestReviewDto>, DeveloperCommandError> {
    developer_review::get_review_state(&state, request)
        .await
        .map_err(|message| DeveloperCommandError {
            code: "review_state_failed".to_owned(),
            message,
            retryable: true,
        })
}

#[tauri::command]
pub async fn pull_request_review_mark_read(
    state: State<'_, SqlitePool>,
    integration_id: String,
    project_key: String,
    repository_slug: String,
    pull_request_id: String,
    latest_commit: Option<String>,
) -> Result<PullRequestActivityStatus, DeveloperCommandError> {
    developer::mark_pull_request_read(
        &state,
        &integration_id,
        &project_key,
        &repository_slug,
        &pull_request_id,
        latest_commit,
    )
    .await
}

#[tauri::command]
pub async fn pull_request_review_mark_all_read(
    state: State<'_, SqlitePool>,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    developer::mark_all_pull_requests_read(&state).await
}

#[tauri::command]
pub async fn bitbucket_search_users(
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketUserDto>, DeveloperCommandError> {
    developer::search_bitbucket_users(&state, &query).await
}

#[tauri::command]
pub async fn bitbucket_search_repositories(
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketRepositoryDto>, DeveloperCommandError> {
    developer::search_bitbucket_repositories(&state, &query).await
}

#[tauri::command]
pub async fn pull_request_review_settings(
    state: State<'_, SqlitePool>,
) -> Result<PullRequestReviewSettings, DeveloperCommandError> {
    developer::get_pull_request_review_settings(&state).await
}

#[tauri::command]
pub async fn save_pull_request_review_settings(
    state: State<'_, SqlitePool>,
    settings: PullRequestReviewSettings,
) -> Result<PullRequestReviewSettings, DeveloperCommandError> {
    developer::save_pull_request_review_settings(&state, settings).await
}
