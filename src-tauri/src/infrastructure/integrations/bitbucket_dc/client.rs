use std::future::Future;

use reqwest::{header, Client, Method, Url};
use serde::de::DeserializeOwned;

use super::error::{BitbucketDcError, BitbucketHttpErrorKind};
const MAX_PULL_REQUEST_DIFF_BYTES: usize = 2_000_000;

use super::models::{
    BitbucketBuildStatus, BitbucketComment, BitbucketDashboardPullRequest, BitbucketPage,
    BitbucketParticipant, BitbucketPullRequest, BitbucketRepository, BitbucketUser,
};

enum Authentication {
    Bearer(String),
    Basic { username: String, password: String },
}

#[derive(Debug, Clone, Copy)]
pub struct BitbucketInlineComment<'a> {
    pub text: &'a str,
    pub from_hash: &'a str,
    pub to_hash: &'a str,
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
        let response = self.authenticated_request(url).query(query).send().await;
        let response = response.map_err(|_| BitbucketDcError::Transport)?;

        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }

        response
            .json::<BitbucketPage<T>>()
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
        let (by_name, by_project) = tokio::join!(
            self.search_repositories_by("name", filter.trim(), limit),
            self.search_repositories_by("projectname", filter.trim(), limit),
        );
        let mut values = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for page in [by_name?, by_project?] {
            for repository in page.values {
                let key = format!("{}/{}", repository.project.key, repository.slug);
                if seen.insert(key) {
                    values.push(repository);
                }
            }
        }
        Ok(BitbucketPage {
            size: Some(values.len() as u64),
            total: None,
            limit: Some(limit),
            start: Some(0),
            is_last_page: true,
            next_page_start: None,
            values,
        })
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
            .send()
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
            .ok_or(BitbucketDcError::InvalidResponse)
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
            .send()
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        response
            .json::<BitbucketPullRequest>()
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
            .send()
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
                &pull_request_id.to_string(),
                "comments",
            ],
            &[("limit", limit.to_string()), ("start", start.to_string())],
        )
        .await
    }

    pub async fn list_pull_request_comments(
        &self,
        project_key: &str,
        repository_slug: &str,
        pull_request_id: u64,
        limit: u64,
    ) -> Result<Vec<BitbucketComment>, BitbucketDcError> {
        validate_limit(limit)?;
        self.collect_pages(|start| {
            self.list_pull_request_comments_page(
                project_key,
                repository_slug,
                pull_request_id,
                start,
                limit,
            )
        })
        .await
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
            || comment.from_hash.trim().is_empty()
            || comment.to_hash.trim().is_empty()
            || comment.path.trim().is_empty()
            || comment.path.chars().any(char::is_control)
            || comment.line.is_some_and(|value| value <= 0)
        {
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
        let mut anchor = serde_json::json!({
            "diffType": "COMMIT",
            "fromHash": comment.from_hash,
            "toHash": comment.to_hash,
            "path": comment.path,
            "srcPath": comment.path,
        });
        if let Some(line) = comment.line {
            anchor["line"] = serde_json::json!(line);
            anchor["lineType"] = serde_json::json!("ADDED");
            anchor["fileType"] = serde_json::json!("TO");
        }
        let response = self
            .authenticated_request_with_method(Method::POST, url)
            .json(&serde_json::json!({ "text": comment.text, "anchor": anchor }))
            .send()
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        response
            .json::<BitbucketComment>()
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
            .send()
            .await
            .map_err(|_| BitbucketDcError::Transport)?;
        if !response.status().is_success() {
            return Err(Self::http_error(response).await);
        }
        response
            .json::<BitbucketParticipant>()
            .await
            .map_err(|_| BitbucketDcError::InvalidResponse)
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
            crate::infrastructure::integrations::error_body::read_safe_error_body(response)
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
