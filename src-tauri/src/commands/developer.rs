use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

use crate::application::authored_pull_requests;
use crate::application::dev_overlay::{DevMockMode, MOCK_INTEGRATION_ID};
use crate::application::developer::{
    self, BitbucketRepositoryDto, BitbucketUserDto, DeveloperCommandError, MyPullRequestsPageDto,
    PullRequestActivity, PullRequestActivityStatus, PullRequestCommentRequest,
    PullRequestCommentStatus, PullRequestDecisionRequest, PullRequestDecisionStatus,
    PullRequestReadAllStatus, PullRequestReviewSettings,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestUnreadCountsDto {
    pub reviewer: u64,
    pub authored: u64,
}

#[tauri::command]
pub async fn bitbucket_pull_request_unread_counts(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<PullRequestUnreadCountsDto, DeveloperCommandError> {
    if mode.is_enabled() {
        let (reviewer, authored) = mode.unread_counts().map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        })?;
        return Ok(PullRequestUnreadCountsDto { reviewer, authored });
    }
    let reviewer_page =
        developer::get_cached_my_pull_requests_page(&state, default_page_size()).await?;
    let authored =
        authored_pull_requests::get_cached_authored_pull_request_unread_count(&state).await?;
    Ok(PullRequestUnreadCountsDto {
        reviewer: reviewer_page
            .values
            .iter()
            .filter(|pull_request| pull_request.activity != PullRequestActivity::Read)
            .count() as u64,
        authored,
    })
}

#[tauri::command]
pub async fn bitbucket_my_pull_requests(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    if mode.is_enabled() {
        return mode.reviewer_page().map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        });
    }
    developer::get_cached_my_pull_requests_page(&state, request.limit).await
}

#[tauri::command]
pub async fn bitbucket_my_pull_requests_refresh(
    app: AppHandle,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    if mode.is_enabled() {
        let page = mode.reviewer_page().map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        })?;
        let _ = app.emit("pull_request_review_updated", &page);
        return Ok(page);
    }
    developer::list_my_pull_requests_page(&state, request.start, request.limit).await
}

#[tauri::command]
pub async fn bitbucket_authored_pull_requests(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    if mode.is_enabled() {
        return mode.authored_page().map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        });
    }
    authored_pull_requests::get_cached_authored_pull_requests_page(
        &state,
        request.start,
        request.limit,
    )
    .await
}

#[tauri::command]
pub async fn bitbucket_authored_pull_requests_refresh(
    app: AppHandle,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestReviewPageRequest,
) -> Result<MyPullRequestsPageDto, DeveloperCommandError> {
    if mode.is_enabled() {
        let page = mode.authored_page().map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        })?;
        let _ = app.emit("my_pull_requests_updated", &page);
        return Ok(page);
    }
    authored_pull_requests::list_authored_pull_requests_page(&state, request.start, request.limit)
        .await
}

#[tauri::command]
pub async fn authored_pull_request_mark_read(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    integration_id: String,
    key: String,
    latest_commit: Option<String>,
) -> Result<bool, DeveloperCommandError> {
    if mode.is_enabled() {
        return mode
            .mark_pull_request_read(
                true,
                &integration_id,
                "MOCK",
                "sample-repository",
                &key,
                latest_commit.as_deref(),
            )
            .map_err(|_| {
                developer::command_error(
                    "mock_mode",
                    "Mock pull request state is unavailable",
                    false,
                )
            });
    }
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
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    if mode.is_enabled() {
        let marked_count = mode.mark_all_pull_requests_read(true).map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        })?;
        return Ok(PullRequestReadAllStatus { marked_count });
    }
    authored_pull_requests::mark_all_authored_pull_requests_read(&state).await
}

#[tauri::command]
pub async fn pull_request_review_start(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    app: AppHandle,
    request: PullRequestReviewRequest,
) -> Result<PullRequestReviewDto, DeveloperCommandError> {
    if mode.is_enabled() {
        if request.integration_id != MOCK_INTEGRATION_ID
            || request.project_key != "MOCK"
            || request.repository_slug != "sample-repository"
            || request.pull_request_id.parse::<u64>().is_err()
        {
            return Err(developer::command_error(
                "mock_mode",
                "The requested pull request is not part of the mock scenario",
                false,
            ));
        }
        let diff = "diff --git a/src/example.rs b/src/example.rs\n--- a/src/example.rs\n+++ b/src/example.rs\n@@ -1,3 +1,4 @@\n pub fn greeting() -> &'static str {\n-    \"hello\"\n+    // MOCK DATA: synthetic change for AI review.\n+    \"hello from the mock scenario\"\n }\n".to_owned();
        return developer_review::start_review_with_diff(&state, &app, request, diff)
            .await
            .map_err(|message| DeveloperCommandError {
                code: "review_start_failed".to_owned(),
                message,
                retryable: true,
                details: None,
            });
    }
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
pub async fn pull_request_review_mark_read(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    integration_id: String,
    project_key: String,
    repository_slug: String,
    pull_request_id: String,
    latest_commit: Option<String>,
) -> Result<PullRequestActivityStatus, DeveloperCommandError> {
    if mode.is_enabled() {
        let marked = mode
            .mark_pull_request_read(
                false,
                &integration_id,
                &project_key,
                &repository_slug,
                &pull_request_id,
                latest_commit.as_deref(),
            )
            .map_err(|_| {
                developer::command_error(
                    "mock_mode",
                    "Mock pull request state is unavailable",
                    false,
                )
            })?;
        if !marked {
            return Err(developer::command_error(
                "mock_mode",
                "Mock pull request changed or was not found",
                false,
            ));
        }
        return Ok(PullRequestActivityStatus {
            integration_id,
            pull_request_id,
            activity: PullRequestActivity::Read,
        });
    }
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
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<PullRequestReadAllStatus, DeveloperCommandError> {
    if mode.is_enabled() {
        let marked_count = mode.mark_all_pull_requests_read(false).map_err(|_| {
            developer::command_error("mock_mode", "Mock pull request state is unavailable", false)
        })?;
        return Ok(PullRequestReadAllStatus { marked_count });
    }
    developer::mark_all_pull_requests_read(&state).await
}

#[tauri::command]
pub async fn pull_request_review_publish_comment(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestCommentRequest,
) -> Result<PullRequestCommentStatus, DeveloperCommandError> {
    if mode.is_enabled() {
        return Err(developer::command_error(
            "mock_mode",
            "External pull request writes are disabled in mock mode",
            false,
        ));
    }
    developer::publish_pull_request_comment(&state, request).await
}

#[tauri::command]
pub async fn pull_request_review_set_decision(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    request: PullRequestDecisionRequest,
) -> Result<PullRequestDecisionStatus, DeveloperCommandError> {
    if mode.is_enabled() {
        return Err(developer::command_error(
            "mock_mode",
            "External pull request writes are disabled in mock mode",
            false,
        ));
    }
    developer::set_pull_request_decision(&state, request).await
}

#[tauri::command]
pub async fn bitbucket_search_users(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketUserDto>, DeveloperCommandError> {
    if mode.is_enabled() {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        return Ok(vec![BitbucketUserDto {
            name: Some("example-user".to_owned()),
            display_name: Some("Example User".to_owned()),
            slug: Some("example-user".to_owned()),
        }]);
    }
    developer::search_bitbucket_users(&state, &query).await
}

#[tauri::command]
pub async fn bitbucket_search_repositories(
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    query: String,
) -> Result<Vec<BitbucketRepositoryDto>, DeveloperCommandError> {
    if mode.is_enabled() {
        let query = query.trim().to_lowercase();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        return Ok(vec![BitbucketRepositoryDto {
            project_key: "MOCK".to_owned(),
            project_name: "MOCK DATA — Example project".to_owned(),
            repository_slug: "sample-repository".to_owned(),
            repository_name: "MOCK DATA — Sample repository".to_owned(),
        }]);
    }
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
