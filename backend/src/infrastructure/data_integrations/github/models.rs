use serde::{Deserialize, Serialize};

use super::error::GithubRateLimit;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubUser {
    pub login: String,
    pub id: u64,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubBranch {
    pub label: String,
    pub r#ref: String,
    pub sha: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GithubPullRequestState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum GithubPullRequestLifecycle {
    Open,
    Closed,
    Merged,
}

impl GithubPullRequestLifecycle {
    pub fn from_pull_request(pull_request: &GithubPullRequest) -> Self {
        if pull_request.merged_at.is_some() {
            Self::Merged
        } else if pull_request.state == GithubPullRequestState::Closed {
            Self::Closed
        } else {
            Self::Open
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum GithubPullRequestTransition {
    Opened,
    Closed,
    Reopened,
    Merged,
}

impl GithubPullRequestTransition {
    pub fn between(
        previous: Option<GithubPullRequestLifecycle>,
        current: GithubPullRequestLifecycle,
    ) -> Option<Self> {
        match (previous, current) {
            (None, GithubPullRequestLifecycle::Open) => Some(Self::Opened),
            (None, GithubPullRequestLifecycle::Closed) => Some(Self::Closed),
            (None, GithubPullRequestLifecycle::Merged) => Some(Self::Merged),
            (Some(GithubPullRequestLifecycle::Open), GithubPullRequestLifecycle::Closed) => {
                Some(Self::Closed)
            }
            (Some(GithubPullRequestLifecycle::Open), GithubPullRequestLifecycle::Merged) => {
                Some(Self::Merged)
            }
            (Some(GithubPullRequestLifecycle::Closed), GithubPullRequestLifecycle::Open) => {
                Some(Self::Reopened)
            }
            (Some(GithubPullRequestLifecycle::Closed), GithubPullRequestLifecycle::Merged) => {
                Some(Self::Merged)
            }
            (Some(GithubPullRequestLifecycle::Merged), _) => None,
            (_, _) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubPullRequest {
    pub id: u64,
    pub number: u64,
    pub state: GithubPullRequestState,
    pub title: String,
    pub body: Option<String>,
    pub user: GithubUser,
    pub html_url: String,
    pub draft: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub merged_at: Option<String>,
    pub head: GithubBranch,
    pub base: GithubBranch,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubReview {
    pub id: u64,
    pub user: Option<GithubUser>,
    pub body: Option<String>,
    pub state: String,
    pub commit_id: Option<String>,
    pub submitted_at: Option<String>,
    pub html_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubComment {
    pub id: u64,
    pub user: Option<GithubUser>,
    pub body: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub line: Option<u64>,
    #[serde(default)]
    pub diff_hunk: Option<String>,
    #[serde(default)]
    pub pull_request_review_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubReviewRequest {
    pub users: Vec<GithubUser>,
    pub teams: Vec<GithubTeam>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubTeam {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCommit {
    pub sha: String,
    pub commit: GithubCommitDetails,
    pub author: Option<GithubUser>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCommitDetails {
    pub message: String,
    pub author: Option<GithubCommitAuthor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCommitAuthor {
    pub name: String,
    pub email: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GithubCheckRunStatus {
    Queued,
    InProgress,
    Completed,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCheckRun {
    pub id: u64,
    pub name: String,
    pub node_id: String,
    pub status: GithubCheckRunStatus,
    pub conclusion: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub html_url: String,
    pub head_sha: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCommitStatus {
    pub url: String,
    pub avatar_url: Option<String>,
    pub id: u64,
    pub node_id: String,
    pub target_url: Option<String>,
    pub description: Option<String>,
    pub context: String,
    pub created_at: String,
    pub updated_at: String,
    pub creator: Option<GithubUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCommitStatusResponse {
    pub state: String,
    pub statuses: Vec<GithubCommitStatus>,
    pub sha: String,
    pub total_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct GithubCheckRunsResponse {
    pub total_count: u64,
    pub check_runs: Vec<GithubCheckRun>,
}

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub struct GithubResponseMetadata {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub retry_after_seconds: Option<u64>,
    pub rate_limit: GithubRateLimit,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct GithubPage<T> {
    pub items: Vec<T>,
    pub pages: u32,
    pub not_modified: bool,
    pub metadata: GithubResponseMetadata,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct GithubResponse<T> {
    pub value: Option<T>,
    pub not_modified: bool,
    pub metadata: GithubResponseMetadata,
}
