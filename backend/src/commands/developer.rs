use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::application::authored_pull_requests;
use crate::application::developer::{
    self, BitbucketProjectDto, BitbucketRepositoryDto, BitbucketUserDto, DeveloperCommandError,
    MyPullRequestsPageDto, PullRequestActivity, PullRequestActivityStatus,
    PullRequestCommentRequest, PullRequestCommentStatus, PullRequestDecisionRequest,
    PullRequestDecisionStatus, PullRequestReadAllStatus, PullRequestRemoveReviewerRequest,
    PullRequestReviewSettings,
};
use crate::application::developer_review::{
    self, PullRequestReviewDto, PullRequestReviewRequest, PullRequestReviewStateRequest,
    PullRequestReviewStatesRequest,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestUnreadCountsDto {
    pub reviewer: u64,
    pub authored: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestUnreadCountsRequest {
    pub reviewer_pending_only: bool,
    pub authored_needs_action_only: bool,
}

#[tauri::command]
pub async fn bitbucket_pull_request_unread_counts(
    state: State<'_, SqlitePool>,
    request: PullRequestUnreadCountsRequest,
) -> Result<PullRequestUnreadCountsDto, DeveloperCommandError> {
    let reviewer_page =
        developer::get_cached_my_pull_requests_page(&state, default_page_size()).await?;
    let authored = authored_pull_requests::get_cached_authored_pull_request_unread_count(
        &state,
        request.authored_needs_action_only,
    )
    .await?;
    Ok(PullRequestUnreadCountsDto {
        reviewer: reviewer_page
            .values
            .iter()
            .filter(|pull_request| pull_request.activity != PullRequestActivity::Read)
            .filter(|pull_request| {
                !request.reviewer_pending_only || pull_request.my_decision == "not_reviewed"
            })
            .count() as u64,
        authored,
    })
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
pub async fn bitbucket_authored_pull_requests(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    authored_pull_requests::get_cached_authored_pull_requests_page(
        &state,
        request.start,
        request.limit,
    )
    .await
}

#[tauri::command]
pub async fn bitbucket_authored_pull_requests_refresh(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    authored_pull_requests::list_authored_pull_requests_page(&state, request.start, request.limit)
        .await
}

#[tauri::command]
pub async fn authored_pull_request_mark_read(
    state: State<'_, SqlitePool>,
    integration_id: String,
    key: String,
    latest_commit: Option<String>,
) -> Result<bool, DeveloperCommandError> {
    authored_pull_requests::mark_authored_pull_request_read(
        &state,
        &integration_id,
        &key,
        latest_commit.as_deref(),
    )
    .await
}
#[tauri::command]
pub async fn authored_pull_requests_mark_all_read(
    state: State<'_, SqlitePool>,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    authored_pull_requests::mark_all_authored_pull_requests_read(&state).await
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
            details: None,
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
            details: None,
        })
}

#[tauri::command]
pub async fn pull_request_review_states(
    state: State<'_, SqlitePool>,
    request: PullRequestReviewStatesRequest,
) -> Result<std::collections::HashMap<String, PullRequestReviewDto>, DeveloperCommandError> {
    developer_review::get_review_states(&state, request.requests)
        .await
        .map_err(|message| DeveloperCommandError {
            code: "review_states_failed".to_owned(),
            message,
            retryable: true,
            details: None,
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
pub async fn pull_request_review_publish_comment(
    state: State<'_, SqlitePool>,
    request: PullRequestCommentRequest,
) -> Result<PullRequestCommentStatus, DeveloperCommandError> {
    developer::publish_pull_request_comment(&state, request).await
}

#[tauri::command]
pub async fn pull_request_review_comment_matches(
    state: State<'_, SqlitePool>,
    request: developer::PullRequestCommentMatchesRequest,
) -> Result<crate::application::review_comment_matches::CommentMatches, DeveloperCommandError> {
    developer::pull_request_comment_matches(&state, request).await
}

#[tauri::command]
pub async fn pull_request_review_set_decision(
    state: State<'_, SqlitePool>,
    request: PullRequestDecisionRequest,
) -> Result<PullRequestDecisionStatus, DeveloperCommandError> {
    developer::set_pull_request_decision(&state, request).await
}

#[tauri::command]
pub async fn pull_request_review_remove_reviewer(
    state: State<'_, SqlitePool>,
    request: PullRequestRemoveReviewerRequest,
) -> Result<(), DeveloperCommandError> {
    developer::remove_pull_request_reviewer(&state, request).await
}

#[tauri::command]
pub async fn bitbucket_search_users(
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketUserDto>, DeveloperCommandError> {
    developer::search_bitbucket_users(&state, &query).await
}

#[tauri::command]
pub async fn bitbucket_search_projects(
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketProjectDto>, DeveloperCommandError> {
    developer::search_bitbucket_projects(&state, &query).await
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
