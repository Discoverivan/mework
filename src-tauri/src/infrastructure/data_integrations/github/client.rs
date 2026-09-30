use std::collections::HashMap;

use reqwest::{header, Url};
use serde::de::DeserializeOwned;

use super::error::{GithubError, GithubErrorKind, GithubRateLimit};
use super::models::{
    GithubCheckRun, GithubCheckRunsResponse, GithubComment, GithubCommit,
    GithubCommitStatusResponse, GithubPage, GithubPullRequest, GithubResponseMetadata,
    GithubReview, GithubReviewRequest,
};

#[derive(Debug, Clone, Default)]
pub struct GithubRequestCache {
    validators: HashMap<String, GithubValidators>,
}

#[derive(Debug, Clone, Default)]
struct GithubValidators {
    etag: Option<String>,
    last_modified: Option<String>,
}

impl GithubRequestCache {
    pub fn clear(&mut self) {
        self.validators.clear();
    }

    pub fn etag_for(&self, scope: &str) -> Option<&str> {
        self.validators.get(scope).and_then(|v| v.etag.as_deref())
    }

    pub fn last_modified_for(&self, scope: &str) -> Option<&str> {
        self.validators
            .get(scope)
            .and_then(|v| v.last_modified.as_deref())
    }
}

pub struct GithubClient {
    http: reqwest::Client,
    base_url: Url,
    token: Option<String>,
}

impl GithubClient {
    pub fn new(base_url: impl AsRef<str>) -> Result<Self, GithubError> {
        let mut base_url =
            Url::parse(base_url.as_ref()).map_err(|_| GithubError::InvalidBaseUrl)?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(GithubError::InvalidBaseUrl);
        }
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        Ok(Self {
            http: reqwest::Client::new(),
            base_url,
            token: None,
        })
    }

    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    pub fn validate_path_segment(segment: &str) -> Result<(), GithubError> {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains('/')
            || segment.contains('\\')
            || segment.chars().any(char::is_control)
        {
            return Err(GithubError::InvalidPathSegment);
        }
        Ok(())
    }

    fn url(&self, segments: &[&str]) -> Result<Url, GithubError> {
        let mut url = self.base_url.clone();
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| GithubError::InvalidBaseUrl)?;
            for segment in segments {
                Self::validate_path_segment(segment)?;
                path.push(segment);
            }
        }
        Ok(url)
    }

    fn commit_url(
        &self,
        owner: &str,
        repo: &str,
        reference: &str,
        suffix: &str,
    ) -> Result<Url, GithubError> {
        Self::validate_path_segment(owner)?;
        Self::validate_path_segment(repo)?;
        if reference.is_empty()
            || reference.contains('\\')
            || reference.chars().any(char::is_control)
        {
            return Err(GithubError::InvalidPathSegment);
        }
        let mut url = self.url(&["repos", owner, repo, "commits"])?;
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| GithubError::InvalidBaseUrl)?;
            path.push(reference);
            Self::validate_path_segment(suffix)?;
            path.push(suffix);
        }
        Ok(url)
    }

    fn request(&self, url: Url, cache: &GithubRequestCache) -> reqwest::RequestBuilder {
        let scope = url.as_str().to_owned();
        let mut request = self
            .http
            .get(url)
            .header(header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(token) = &self.token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        if let Some(etag) = cache.etag_for(&scope) {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
        if let Some(last_modified) = cache.last_modified_for(&scope) {
            request = request.header(header::IF_MODIFIED_SINCE, last_modified);
        }
        request
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        url: Url,
        cache: &mut GithubRequestCache,
    ) -> Result<(Option<T>, bool, GithubResponseMetadata, Option<u32>), GithubError> {
        let scope = url.as_str().to_owned();
        let response = self
            .request(url, cache)
            .send()
            .await
            .map_err(|_| GithubError::Transport)?;
        let metadata = response_metadata(response.headers());
        if response.status().as_u16() == 304 {
            return Ok((None, true, metadata, None));
        }
        if !response.status().is_success() {
            return Err(classify_http(response.status().as_u16(), &metadata));
        }
        let next_page = response
            .headers()
            .get(header::LINK)
            .and_then(|value| value.to_str().ok())
            .and_then(next_page_from_link);
        let value = response
            .json::<T>()
            .await
            .map_err(|_| GithubError::InvalidResponse)?;
        cache.validators.insert(
            scope,
            GithubValidators {
                etag: metadata.etag.clone(),
                last_modified: metadata.last_modified.clone(),
            },
        );
        Ok((Some(value), false, metadata, next_page))
    }

    async fn paged<T: DeserializeOwned>(
        &self,
        endpoint: Url,
        query: &[(&str, String)],
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<T>, GithubError> {
        if !(1..=100).contains(&page_size) {
            return Err(GithubError::InvalidPageSize);
        }
        let mut page = 1_u32;
        let mut pages = 0_u32;
        let mut items = Vec::new();
        let metadata = loop {
            let mut url = endpoint.clone();
            {
                let mut pairs = url.query_pairs_mut();
                for (name, value) in query {
                    pairs.append_pair(name, value);
                }
                pairs.append_pair("per_page", &page_size.to_string());
                pairs.append_pair("page", &page.to_string());
            }
            let (value, not_modified, current_metadata, linked_page) =
                self.get_json::<Vec<T>>(url, cache).await?;
            if not_modified {
                return Ok(GithubPage {
                    items,
                    pages,
                    not_modified: true,
                    metadata: current_metadata,
                });
            }
            pages += 1;
            items.extend(value.ok_or(GithubError::InvalidResponse)?);
            match linked_page {
                Some(next) => page = next,
                None => break current_metadata,
            }
        };
        Ok(GithubPage {
            items,
            pages,
            not_modified: false,
            metadata,
        })
    }

    pub async fn list_pull_requests(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubPullRequest>, GithubError> {
        Self::validate_path_segment(owner)?;
        Self::validate_path_segment(repo)?;
        Self::validate_path_segment(state)?;
        self.paged(
            self.url(&["repos", owner, repo, "pulls"])?,
            &[("state", state.to_owned())],
            page_size,
            cache,
        )
        .await
    }

    pub async fn get_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        cache: &mut GithubRequestCache,
    ) -> Result<super::models::GithubResponse<GithubPullRequest>, GithubError> {
        if number == 0 {
            return Err(GithubError::InvalidPathSegment);
        }
        let (value, not_modified, metadata, _) = self
            .get_json(
                self.url(&["repos", owner, repo, "pulls", &number.to_string()])?,
                cache,
            )
            .await?;
        Ok(super::models::GithubResponse {
            value,
            not_modified,
            metadata,
        })
    }

    pub async fn list_reviews(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubReview>, GithubError> {
        self.list_pull_endpoint(owner, repo, number, "reviews", page_size, cache)
            .await
    }

    pub async fn list_review_comments(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubComment>, GithubError> {
        self.list_pull_endpoint(owner, repo, number, "comments", page_size, cache)
            .await
    }

    pub async fn list_issue_comments(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubComment>, GithubError> {
        self.list_collection_endpoint(owner, repo, number, "issues", "comments", page_size, cache)
            .await
    }

    pub async fn list_comments(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubComment>, GithubError> {
        self.list_issue_comments(owner, repo, number, page_size, cache)
            .await
    }

    async fn list_pull_endpoint<T: DeserializeOwned>(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        endpoint: &str,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<T>, GithubError> {
        self.list_collection_endpoint(owner, repo, number, "pulls", endpoint, page_size, cache)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn list_collection_endpoint<T: DeserializeOwned>(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        collection: &str,
        endpoint: &str,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<T>, GithubError> {
        if number == 0 {
            return Err(GithubError::InvalidPathSegment);
        }
        Self::validate_path_segment(owner)?;
        Self::validate_path_segment(repo)?;
        self.paged(
            self.url(&[
                "repos",
                owner,
                repo,
                collection,
                &number.to_string(),
                endpoint,
            ])?,
            &[],
            page_size,
            cache,
        )
        .await
    }

    pub async fn list_review_requests(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        cache: &mut GithubRequestCache,
    ) -> Result<super::models::GithubResponse<GithubReviewRequest>, GithubError> {
        if number == 0 {
            return Err(GithubError::InvalidPathSegment);
        }
        let (value, not_modified, metadata, _) = self
            .get_json(
                self.url(&[
                    "repos",
                    owner,
                    repo,
                    "pulls",
                    &number.to_string(),
                    "requested_reviewers",
                ])?,
                cache,
            )
            .await?;
        Ok(super::models::GithubResponse {
            value,
            not_modified,
            metadata,
        })
    }

    pub async fn list_commits(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubCommit>, GithubError> {
        self.list_pull_endpoint(owner, repo, number, "commits", page_size, cache)
            .await
    }

    pub async fn list_check_runs(
        &self,
        owner: &str,
        repo: &str,
        reference: &str,
        page_size: u32,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPage<GithubCheckRun>, GithubError> {
        if !(1..=100).contains(&page_size) {
            return Err(GithubError::InvalidPageSize);
        }
        let endpoint = self.commit_url(owner, repo, reference, "check-runs")?;
        let mut page = 1_u32;
        let mut pages = 0_u32;
        let mut items = Vec::new();
        let metadata = loop {
            let mut url = endpoint.clone();
            {
                let mut pairs = url.query_pairs_mut();
                pairs.append_pair("per_page", &page_size.to_string());
                pairs.append_pair("page", &page.to_string());
            }
            let (value, not_modified, current_metadata, next) =
                self.get_json::<GithubCheckRunsResponse>(url, cache).await?;
            if not_modified {
                return Ok(GithubPage {
                    items,
                    pages,
                    not_modified: true,
                    metadata: current_metadata,
                });
            }
            pages += 1;
            items.extend(value.ok_or(GithubError::InvalidResponse)?.check_runs);
            match next {
                Some(next_page) => page = next_page,
                None => break current_metadata,
            }
        };
        Ok(GithubPage {
            items,
            pages,
            not_modified: false,
            metadata,
        })
    }

    pub async fn get_commit_status(
        &self,
        owner: &str,
        repo: &str,
        reference: &str,
        cache: &mut GithubRequestCache,
    ) -> Result<super::models::GithubResponse<GithubCommitStatusResponse>, GithubError> {
        let (value, not_modified, metadata, _) = self
            .get_json(self.commit_url(owner, repo, reference, "status")?, cache)
            .await?;
        Ok(super::models::GithubResponse {
            value,
            not_modified,
            metadata,
        })
    }
}

fn response_metadata(headers: &header::HeaderMap) -> GithubResponseMetadata {
    GithubResponseMetadata {
        etag: header_string(headers, header::ETAG),
        last_modified: header_string(headers, header::LAST_MODIFIED),
        retry_after_seconds: header_u64(headers, header::RETRY_AFTER.as_str()),
        rate_limit: GithubRateLimit {
            limit: header_u64(headers, "x-ratelimit-limit"),
            remaining: header_u64(headers, "x-ratelimit-remaining"),
            used: header_u64(headers, "x-ratelimit-used"),
            reset_epoch_seconds: header_u64(headers, "x-ratelimit-reset"),
        },
    }
}

fn header_string(headers: &header::HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
}

fn header_u64(headers: &header::HeaderMap, name: &str) -> Option<u64> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

fn classify_http(status: u16, metadata: &GithubResponseMetadata) -> GithubError {
    let kind = match status {
        401 => GithubErrorKind::Authentication,
        403 if metadata.rate_limit.remaining == Some(0) => GithubErrorKind::RateLimited,
        403 => GithubErrorKind::Authorization,
        404 => GithubErrorKind::NotFound,
        422 => GithubErrorKind::Validation,
        429 => GithubErrorKind::RateLimited,
        500..=599 => GithubErrorKind::Transient,
        _ => GithubErrorKind::Unknown,
    };
    GithubError::Http {
        status,
        kind,
        retryable: matches!(
            kind,
            GithubErrorKind::RateLimited | GithubErrorKind::Transient
        ),
        retry_after_seconds: metadata.retry_after_seconds,
        rate_limit: metadata.rate_limit,
    }
}

fn next_page_from_link(link: &str) -> Option<u32> {
    link.split(',')
        .find(|part| part.contains("rel=\"next\"") || part.contains("rel=next"))
        .and_then(|part| part.split(';').next())
        .and_then(|target| target.split("page=").nth(1))
        .and_then(|page| page.split('&').next())
        .and_then(|page| page.trim_end_matches('>').parse().ok())
}
