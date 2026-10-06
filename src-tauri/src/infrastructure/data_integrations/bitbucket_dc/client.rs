use std::future::Future;

use reqwest::{header, Client, Method, Url};
use serde::de::DeserializeOwned;

use super::error::{BitbucketDcError, BitbucketHttpErrorKind};
use crate::application::logging::HttpRequestBuilderExt;
const MAX_PULL_REQUEST_DIFF_BYTES: usize = 2_000_000;

use super::models::{
    BitbucketBuildStatus, BitbucketComment, BitbucketDashboardPullRequest, BitbucketDiffResponse,
    BitbucketPage, BitbucketParticipant, BitbucketProject, BitbucketPullRequest,
    BitbucketPullRequestActivity, BitbucketRepository, BitbucketUser,
};

enum Authentication {
    Bearer(String),
    Basic { username: String, password: String },
}

#[derive(Debug, Clone, Copy)]
pub struct BitbucketInlineComment<'a> {
    pub text: &'a str,
    pub path: &'a str,
    pub line: Option<i64>,
}

pub struct BitbucketDcClient {
    http: reqwest::Client,
    base_url: Url,
    authentication: Option<Authentication>,
}

impl BitbucketDcClient {
    pub fn new(base_url: impl AsRef<str>) -> Result<Self, BitbucketDcError> {
        Self::with_authentication(base_url, None)
    }

    pub fn with_bearer_token(
        base_url: impl AsRef<str>,
        token: impl Into<String>,
    ) -> Result<Self, BitbucketDcError> {
        let token = token.into();
        if token.trim().is_empty() {
            return Err(BitbucketDcError::InvalidCredentials);
        }
        Self::with_authentication(base_url, Some(Authentication::Bearer(token)))
    }

    pub fn with_bearer_token_and_client(
        base_url: impl AsRef<str>,
        token: impl Into<String>,
        http: Client,
    ) -> Result<Self, BitbucketDcError> {
        let token = token.into();
        if token.trim().is_empty() {
            return Err(BitbucketDcError::InvalidCredentials);
        }
        Self::with_authentication_and_client(base_url, Some(Authentication::Bearer(token)), http)
    }

    pub fn with_basic_auth_and_client(
        base_url: impl AsRef<str>,
        username: impl Into<String>,
        password: impl Into<String>,
        http: Client,
    ) -> Result<Self, BitbucketDcError> {
        let username = username.into();
        let password = password.into();
        if username.is_empty() || password.is_empty() {
            return Err(BitbucketDcError::InvalidCredentials);
        }
        Self::with_authentication_and_client(
            base_url,
            Some(Authentication::Basic { username, password }),
            http,
        )
    }
    pub fn with_basic_auth(
        base_url: impl AsRef<str>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Result<Self, BitbucketDcError> {
        let username = username.into();
        let password = password.into();
        if username.is_empty() || password.is_empty() {
            return Err(BitbucketDcError::InvalidCredentials);
        }
        Self::with_authentication(base_url, Some(Authentication::Basic { username, password }))
    }

    async fn fetch_page<T>(
        &self,
        path_segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<BitbucketPage<T>, BitbucketDcError>
    where
        T: DeserializeOwned,
    {
        let url = self.url_with_segments(path_segments)?;
        let response = self
            .authenticated_request(url)
            .query(query)
            .send_logged(
                "data_integrations.bitbucket_dc",
                "fetch_page",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;

        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }

        crate::application::logging::parse_json_response::<BitbucketPage<T>>(
            response,
            "data_integrations.bitbucket_dc",
            "fetch_page",
        )
        .await
        .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn list_repositories_page(
        &self,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketRepository>, BitbucketDcError> {
        validate_limit(limit)?;
        self.fetch_page(
            &["rest", "api", "1.0", "repos"],
            &[("limit", limit.to_string()), ("start", start.to_string())],
        )
        .await
    }

    pub async fn list_repositories(
        &self,
        limit: u64,
    ) -> Result<Vec<BitbucketRepository>, BitbucketDcError> {
        validate_limit(limit)?;
        self.collect_pages(|start| self.list_repositories_page(start, limit))
            .await
    }

    pub async fn list_my_pull_requests_page(
        &self,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketDashboardPullRequest>, BitbucketDcError> {
        self.list_dashboard_pull_requests_page("REVIEWER", start, limit, true)
            .await
    }

    pub async fn list_authored_pull_requests_page(
        &self,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketDashboardPullRequest>, BitbucketDcError> {
        match self
            .list_dashboard_pull_requests_page("AUTHOR", start, limit, true)
            .await
        {
            Err(BitbucketDcError::Http { status: 400, .. }) => {
                // Some older Server/DC versions reject the optional state query
                // for the AUTHOR dashboard role. Filter OPEN records locally.
                self.list_dashboard_pull_requests_page("AUTHOR", start, limit, false)
                    .await
            }
            result => result,
        }
    }

    async fn list_dashboard_pull_requests_page(
        &self,
        role: &str,
        start: u64,
        limit: u64,
        include_state: bool,
    ) -> Result<BitbucketPage<BitbucketDashboardPullRequest>, BitbucketDcError> {
        validate_limit(limit)?;
        let mut query = vec![
            ("role", role.to_owned()),
            ("order", "NEWEST".to_owned()),
            ("limit", limit.to_string()),
            ("start", start.to_string()),
        ];
        if include_state {
            query.insert(1, ("state", "OPEN".to_owned()));
        }
        let mut page: BitbucketPage<BitbucketDashboardPullRequest> = self
            .fetch_page(
                &["rest", "api", "1.0", "dashboard", "pull-requests"],
                &query,
            )
            .await?;
        page.values.retain(|pull_request| {
            pull_request.open
                && pull_request.state.eq_ignore_ascii_case("OPEN")
                && !pull_request.draft
        });
        page.size = Some(page.values.len() as u64);
        Ok(page)
    }

    pub async fn search_users(
        &self,
        filter: &str,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketUser>, BitbucketDcError> {
        validate_limit(limit)?;
        if filter.trim().chars().count() < 3 {
            return Err(BitbucketDcError::InvalidRequest);
        }
        self.fetch_page(
            &["rest", "api", "1.0", "users"],
            &[
                ("filter", filter.trim().to_owned()),
                ("limit", limit.to_string()),
            ],
        )
        .await
    }

    pub async fn search_repositories(
        &self,
        filter: &str,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketRepository>, BitbucketDcError> {
        validate_limit(limit)?;
        if filter.trim().chars().count() < 3 {
            return Err(BitbucketDcError::InvalidRequest);
        }
        self.search_repositories_by("name", filter.trim(), limit)
            .await
    }

    pub async fn search_projects(
        &self,
        filter: &str,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketProject>, BitbucketDcError> {
        validate_limit(limit)?;
        if filter.trim().chars().count() < 3 {
            return Err(BitbucketDcError::InvalidRequest);
        }
        self.fetch_page(
            &["rest", "api", "1.0", "projects"],
            &[
                ("name", filter.trim().to_owned()),
                ("limit", limit.to_string()),
                ("start", "0".to_owned()),
            ],
        )
        .await
    }

    async fn search_repositories_by(
        &self,
        parameter: &str,
        filter: &str,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketRepository>, BitbucketDcError> {
        self.fetch_page(
            &["rest", "api", "1.0", "repos"],
            &[
                (parameter, filter.to_owned()),
                ("limit", limit.to_string()),
                ("start", "0".to_owned()),
            ],
        )
        .await
    }

    pub async fn list_pull_requests_page(
        &self,
        project_key: &str,
        repository_slug: &str,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketPullRequest>, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        validate_limit(limit)?;
        self.fetch_page(
            &[
                "rest",
                "api",
                "1.0",
                "projects",
                project_key,
                "repos",
                repository_slug,
                "pull-requests",
            ],
            &[
                ("state", "ALL".to_owned()),
                ("limit", limit.to_string()),
                ("start", start.to_string()),
            ],
        )
        .await
    }

    pub async fn list_pull_requests(
        &self,
        project_key: &str,
        repository_slug: &str,
        limit: u64,
    ) -> Result<Vec<BitbucketPullRequest>, BitbucketDcError> {
        validate_limit(limit)?;
        self.collect_pages(|start| {
            self.list_pull_requests_page(project_key, repository_slug, start, limit)
        })
        .await
    }

    pub async fn authenticated_user_slug(&self) -> Result<String, BitbucketDcError> {
        let url = self.url_with_segments(&["rest", "api", "1.0", "repos"])?;
        let response = self
            .authenticated_request(url)
            .query(&[("limit", "1")])
            .send_logged(
                "data_integrations.bitbucket_dc",
                "authenticated_user_slug",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        response
            .headers()
            .get("x-ausername")
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty() && !value.chars().any(char::is_whitespace))
            .map(str::to_owned)
            .ok_or_else(|| {
                crate::application::logging::log_business_failure(
                    "data_integrations.bitbucket_dc",
                    "authenticated_user_slug",
                    "username_header_missing",
                    "successful response omitted the expected username header",
                );
                BitbucketDcError::InvalidResponse
            })
    }

    pub async fn get_pull_request(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
    ) -> Result<BitbucketPullRequest, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
        ])?;
        let response = self
            .authenticated_request(url)
            .send_logged(
                "data_integrations.bitbucket_dc",
                "get_pull_request",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        crate::application::logging::parse_json_response::<BitbucketPullRequest>(
            response,
            "data_integrations.bitbucket_dc",
            "get_pull_request",
        )
        .await
        .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn pull_request_diff(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
    ) -> Result<String, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        let path = format!("{pull_request_id}.diff");
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &path,
        ])?;
        let response = self
            .authenticated_request(url)
            .send_logged(
                "data_integrations.bitbucket_dc",
                "pull_request_diff",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        let body = response
            .text()
            .await
            .map_err(|_| BitbucketDcError::InvalidResponse)?;
        if body.len() > MAX_PULL_REQUEST_DIFF_BYTES {
            crate::application::logging::log_business_failure(
                "data_integrations.bitbucket_dc",
                "pull_request_diff",
                "response_size_limit",
                "successful response exceeded the supported diff size",
            );
            return Err(BitbucketDcError::InvalidResponse);
        }
        Ok(body)
    }

    pub async fn list_pull_request_comments_page(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketComment>, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        validate_limit(limit)?;
        // GET /comments is file-scoped and requires path. The activity feed
        // provides all PR comments and keeps inline anchors on the activity.
        let page: BitbucketPage<BitbucketPullRequestActivity> = self
            .fetch_page(
                &[
                    "rest",
                    "api",
                    "1.0",
                    "projects",
                    project_key,
                    "repos",
                    repository_slug,
                    "pull-requests",
                    &pull_request_id.to_string(),
                    "activities",
                ],
                &[("limit", limit.to_string()), ("start", start.to_string())],
            )
            .await?;
        fn inherit_anchor(
            comment: &mut BitbucketComment,
            anchor: Option<&super::models::BitbucketCommentAnchor>,
        ) {
            if comment.anchor.is_none() {
                comment.anchor = anchor.cloned();
            }
            for reply in &mut comment.comments {
                inherit_anchor(reply, comment.anchor.as_ref());
            }
        }
        Ok(BitbucketPage {
            values: page
                .values
                .into_iter()
                .filter_map(|activity| {
                    let mut comment = activity.comment?;
                    if activity.comment_action.as_deref() == Some("DELETED") {
                        comment.deleted = Some(true);
                    }
                    inherit_anchor(&mut comment, activity.comment_anchor.as_ref());
                    Some(comment)
                })
                .collect(),
            is_last_page: page.is_last_page,
            next_page_start: page.next_page_start,
            size: page.size,
            total: page.total,
            limit: page.limit,
            start: page.start,
        })
    }

    pub async fn list_pull_request_comments(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        limit: u64,
    ) -> Result<Vec<BitbucketComment>, BitbucketDcError> {
        validate_limit(limit)?;
        let comments = self
            .collect_pages(|start| {
                self.list_pull_request_comments_page(
                    project_key,
                    repository_slug,
                    pull_request_id,
                    start,
                    limit,
                )
            })
            .await?;
        // Activities are newest first; retain the current version of each thread.
        let mut seen = std::collections::HashSet::new();
        Ok(comments
            .into_iter()
            .filter(|comment| seen.insert(comment.id))
            .collect())
    }

    /// Rebuild publication status from the PR instead of a local publication history.
    pub async fn published_pull_request_comment_indices(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        findings: &[BitbucketInlineComment<'_>],
    ) -> Result<Vec<usize>, BitbucketDcError> {
        let comments = self
            .list_pull_request_comments(project_key, repository_slug, pull_request_id, 100)
            .await?;
        if comments.is_empty() {
            return Ok(Vec::new());
        }
        fn needs_context_diff(
            comments: &[BitbucketComment],
            findings: &[BitbucketInlineComment<'_>],
        ) -> bool {
            comments.iter().any(|comment| {
                (comment.deleted != Some(true)
                    && comment.anchor.as_ref().is_some_and(|anchor| {
                        anchor.line_type.as_deref() == Some("CONTEXT")
                            && anchor.file_type.as_deref() != Some("TO")
                            && findings.iter().any(|finding| {
                                finding.line.is_some()
                                    && anchor.path.as_deref() == Some(finding.path)
                                    && comment.text.trim() == finding.text.trim()
                            })
                    }))
                    || needs_context_diff(&comment.comments, findings)
            })
        }
        // Added-line and file comments already use the finding's coordinates.
        // Only fetch the full diff when a matching old-side context anchor needs it.
        let diff = if needs_context_diff(&comments, findings) {
            Some(
                self.pull_request_comment_diff(project_key, repository_slug, pull_request_id)
                    .await?,
            )
        } else {
            None
        };
        fn contains(
            comments: &[BitbucketComment],
            finding: BitbucketInlineComment<'_>,
            diff: Option<&BitbucketDiffResponse>,
        ) -> bool {
            comments.iter().any(|comment| {
                let matches = comment.deleted != Some(true)
                    && comment.text.trim() == finding.text.trim()
                    && comment.anchor.as_ref().is_some_and(|anchor| {
                        if anchor.path.as_deref() != Some(finding.path) {
                            return false;
                        }
                        if anchor.line_type.as_deref() == Some("REMOVED") {
                            return false;
                        }
                        // Publication anchors CONTEXT lines on the old side of the diff.
                        let line = if anchor.line_type.as_deref() == Some("CONTEXT")
                            && anchor.file_type.as_deref() != Some("TO")
                            && anchor.line.is_some()
                        {
                            let Some(diff) = diff else { return false };
                            diff.diffs
                                .iter()
                                .filter(|file| {
                                    file.destination
                                        .as_ref()
                                        .or(file.source.as_ref())
                                        .is_some_and(|path| path.path == finding.path)
                                })
                                .flat_map(|file| &file.hunks)
                                .flat_map(|hunk| &hunk.segments)
                                .filter(|segment| segment.line_type == "CONTEXT")
                                .flat_map(|segment| &segment.lines)
                                .find(|line| Some(line.source) == anchor.line)
                                .map(|line| line.destination)
                        } else {
                            anchor.line
                        };
                        line == finding.line
                    });
                matches || contains(&comment.comments, finding, diff)
            })
        }
        Ok(findings
            .iter()
            .enumerate()
            .filter_map(|(index, finding)| {
                contains(&comments, *finding, diff.as_ref()).then_some(index)
            })
            .collect())
    }

    async fn pull_request_comment_diff(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
    ) -> Result<BitbucketDiffResponse, BitbucketDcError> {
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
            "diff",
        ])?;
        let response = self
            .authenticated_request(url)
            .query(&[("diffType", "EFFECTIVE"), ("withComments", "false")])
            .header(header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        response
            .json()
            .await
            .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn publish_pull_request_comment(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        comment: BitbucketInlineComment<'_>,
    ) -> Result<BitbucketComment, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        if comment.text.trim().is_empty()
            || comment.path.trim().is_empty()
            || comment.path.chars().any(char::is_control)
            || comment.line.is_some_and(|value| value <= 0)
        {
            return Err(BitbucketDcError::InvalidRequest);
        }
        let diff = self
            .pull_request_comment_diff(project_key, repository_slug, pull_request_id)
            .await?;
        let file = diff
            .diffs
            .iter()
            .find(|file| {
                file.destination
                    .as_ref()
                    .or(file.source.as_ref())
                    .is_some_and(|path| path.path == comment.path)
            })
            .ok_or(BitbucketDcError::InvalidRequest)?;
        // Anchor to the complete PR diff, not an arbitrary branch-head commit pair.
        let mut anchor = serde_json::json!({ "diffType": "EFFECTIVE", "path": comment.path });
        if let Some(source) = &file.source {
            if source.path != comment.path {
                anchor["srcPath"] = serde_json::json!(source.path);
            }
        }
        if let Some(requested_line) = comment.line {
            let (segment, line) = file
                .hunks
                .iter()
                .flat_map(|hunk| &hunk.segments)
                .filter(|segment| matches!(segment.line_type.as_str(), "ADDED" | "CONTEXT"))
                .find_map(|segment| {
                    segment
                        .lines
                        .iter()
                        .find(|line| line.destination == requested_line)
                        .map(|line| (segment, line))
                })
                .ok_or(BitbucketDcError::InvalidRequest)?;
            // AI findings use new-file coordinates. Context anchors use the corresponding old line.
            let (line_number, side) = if segment.line_type == "CONTEXT" {
                (line.source, "FROM")
            } else {
                (line.destination, "TO")
            };
            if line_number <= 0 {
                return Err(BitbucketDcError::InvalidResponse);
            }
            anchor["line"] = serde_json::json!(line_number);
            anchor["lineType"] = serde_json::json!(segment.line_type);
            anchor["fileType"] = serde_json::json!(side);
        }
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
            "comments",
        ])?;
        let response = self
            .authenticated_request_with_method(Method::POST, url)
            .json(&serde_json::json!({ "text": comment.text, "anchor": anchor }))
            .send_logged(
                "data_integrations.bitbucket_dc",
                "publish_pull_request_comment",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        crate::application::logging::parse_json_response::<BitbucketComment>(
            response,
            "data_integrations.bitbucket_dc",
            "publish_pull_request_comment",
        )
        .await
        .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn reply_pull_request_comment(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        parent_id: u64,
        text: &str,
    ) -> Result<BitbucketComment, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        if parent_id == 0 || text.trim().is_empty() {
            return Err(BitbucketDcError::InvalidRequest);
        }
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
            "comments",
        ])?;
        let response = self
            .authenticated_request_with_method(Method::POST, url)
            .json(&serde_json::json!({ "text": text, "parent": { "id": parent_id } }))
            .send_logged(
                "data_integrations.bitbucket_dc",
                "reply_pull_request_comment",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        crate::application::logging::parse_json_response::<BitbucketComment>(
            response,
            "data_integrations.bitbucket_dc",
            "reply_pull_request_comment",
        )
        .await
        .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn set_pull_request_participant_status(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        user_slug: &str,
        status: &str,
    ) -> Result<BitbucketParticipant, BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        validate_path_segment(user_slug)?;
        if !matches!(status, "APPROVED" | "NEEDS_WORK") {
            return Err(BitbucketDcError::InvalidRequest);
        }
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
            "participants",
            user_slug,
        ])?;
        let response = self
            .authenticated_request_with_method(Method::PUT, url)
            .json(&serde_json::json!({
                "user": { "name": user_slug },
                "approved": status == "APPROVED",
                "status": status,
            }))
            .send_logged(
                "data_integrations.bitbucket_dc",
                "set_pull_request_participant_status",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        crate::application::logging::parse_json_response::<BitbucketParticipant>(
            response,
            "data_integrations.bitbucket_dc",
            "set_pull_request_participant_status",
        )
        .await
        .map_err(|_| BitbucketDcError::InvalidResponse)
    }

    pub async fn unassign_pull_request_reviewer(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        user_slug: &str,
    ) -> Result<(), BitbucketDcError> {
        validate_path_segment(project_key)?;
        validate_path_segment(repository_slug)?;
        validate_path_segment(user_slug)?;
        let url = self.url_with_segments(&[
            "rest",
            "api",
            "1.0",
            "projects",
            project_key,
            "repos",
            repository_slug,
            "pull-requests",
            &pull_request_id.to_string(),
            "participants",
            user_slug,
        ])?;
        let response = self
            .authenticated_request_with_method(Method::DELETE, url)
            .send_logged(
                "data_integrations.bitbucket_dc",
                "unassign_pull_request_reviewer",
                crate::application::logging::HttpBodyPolicy::Integration,
            )
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        Ok(())
    }

    pub async fn list_commit_statuses_page(
        &self,
        commit_id: &str,
        start: u64,
        limit: u64,
    ) -> Result<BitbucketPage<BitbucketBuildStatus>, BitbucketDcError> {
        validate_path_segment(commit_id)?;
        validate_limit(limit)?;
        self.fetch_page(
            &["rest", "build-status", "1.0", "commits", commit_id],
            &[("limit", limit.to_string()), ("start", start.to_string())],
        )
        .await
    }

    pub async fn list_commit_statuses(
        &self,
        commit_id: &str,
        limit: u64,
    ) -> Result<Vec<BitbucketBuildStatus>, BitbucketDcError> {
        validate_limit(limit)?;
        self.collect_pages(|start| self.list_commit_statuses_page(commit_id, start, limit))
            .await
    }

    pub async fn list_build_statuses(
        &self,
        commit_id: &str,
        limit: u64,
    ) -> Result<Vec<BitbucketBuildStatus>, BitbucketDcError> {
        self.list_commit_statuses(commit_id, limit).await
    }

    async fn collect_pages<T, F, Fut>(&self, mut fetch: F) -> Result<Vec<T>, BitbucketDcError>
    where
        F: FnMut(u64) -> Fut,
        Fut: Future<Output = Result<BitbucketPage<T>, BitbucketDcError>>,
    {
        let mut start = 0;
        let mut values = Vec::new();
        loop {
            let page = fetch(start).await?;
            values.extend(page.values);
            if page.is_last_page {
                return Ok(values);
            }
            let next = page
                .next_page_start
                .filter(|next_start| *next_start > start)
                .ok_or(BitbucketDcError::InvalidResponse)?;
            start = next;
        }
    }

    fn with_authentication(
        base_url: impl AsRef<str>,
        authentication: Option<Authentication>,
    ) -> Result<Self, BitbucketDcError> {
        Self::with_authentication_and_client(base_url, authentication, Client::new())
    }

    fn with_authentication_and_client(
        base_url: impl AsRef<str>,
        authentication: Option<Authentication>,
        http: Client,
    ) -> Result<Self, BitbucketDcError> {
        let mut base_url =
            Url::parse(base_url.as_ref()).map_err(|_| BitbucketDcError::InvalidBaseUrl)?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(BitbucketDcError::InvalidBaseUrl);
        }
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }

        Ok(Self {
            http,
            base_url,
            authentication,
        })
    }

    fn url_with_segments(&self, path_segments: &[&str]) -> Result<Url, BitbucketDcError> {
        let relative_path = path_segments
            .iter()
            .map(|segment| encode_path_segment(segment))
            .collect::<Vec<_>>()
            .join("/");
        self.base_url
            .join(&relative_path)
            .map_err(|_| BitbucketDcError::InvalidBaseUrl)
    }

    fn authenticated_request(&self, url: Url) -> reqwest::RequestBuilder {
        self.authenticated_request_with_method(Method::GET, url)
    }

    fn authenticated_request_with_method(
        &self,
        method: Method,
        url: Url,
    ) -> reqwest::RequestBuilder {
        let request = self.http.request(method, url);
        match &self.authentication {
            Some(Authentication::Bearer(token)) => request.bearer_auth(token),
            Some(Authentication::Basic { username, password }) => {
                request.basic_auth(username, Some(password))
            }
            None => request,
        }
    }

    async fn http_error(response: reqwest::Response) -> BitbucketDcError {
        let status = response.status().as_u16();
        let kind = match status {
            401 => BitbucketHttpErrorKind::Authentication,
            403 => BitbucketHttpErrorKind::PermissionDenied,
            429 => BitbucketHttpErrorKind::RateLimited,
            500..=599 => BitbucketHttpErrorKind::Server,
            400..=499 => BitbucketHttpErrorKind::Client,
            _ => BitbucketHttpErrorKind::Other,
        };
        let retryable = matches!(status, 408 | 429 | 500..=599);
        let retry_after_seconds = response
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok());
        let detail =
            crate::infrastructure::data_integrations::error_body::read_safe_error_body(response)
                .await
                .map(|body| body.to_string());
        BitbucketDcError::Http {
            status,
            kind,
            retryable,
            retry_after_seconds,
            detail,
        }
    }
}

fn validate_limit(limit: u64) -> Result<(), BitbucketDcError> {
    if limit == 0 {
        Err(BitbucketDcError::InvalidRequest)
    } else {
        Ok(())
    }
}

fn validate_path_segment(segment: &str) -> Result<(), BitbucketDcError> {
    if segment.is_empty() {
        Err(BitbucketDcError::InvalidRequest)
    } else {
        Ok(())
    }
}

fn encode_path_segment(segment: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}
