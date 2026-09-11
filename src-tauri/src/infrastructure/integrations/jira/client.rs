use reqwest::Url;

use super::error::JiraError;
use super::models::{JiraSearchPage, JiraSearchResult};

pub struct JiraClient {
    http: reqwest::Client,
    base_url: Url,
}

impl JiraClient {
    pub fn new(base_url: impl AsRef<str>) -> Result<Self, JiraError> {
        let mut base_url = Url::parse(base_url.as_ref()).map_err(|_| JiraError::InvalidBaseUrl)?;
        if !base_url.path().ends_with('/') {
            let path = format!("{}/", base_url.path());
            base_url.set_path(&path);
        }

        Ok(Self {
            http: reqwest::Client::new(),
            base_url,
        })
    }

    pub async fn search_issues(
        &self,
        jql: &str,
        page_size: u64,
    ) -> Result<JiraSearchResult, JiraError> {
        if page_size == 0 {
            return Err(JiraError::InvalidResponse);
        }

        let endpoint = self
            .base_url
            .join("rest/api/2/search")
            .map_err(|_| JiraError::InvalidBaseUrl)?;
        let mut start_at = 0_u64;
        let mut page_count = 0_u32;
        let mut issues = Vec::new();

        loop {
            let response = self
                .http
                .get(endpoint.clone())
                .query(&[
                    ("jql", jql.to_owned()),
                    ("startAt", start_at.to_string()),
                    ("maxResults", page_size.to_string()),
                ])
                .send()
                .await
                .map_err(|_| JiraError::Transport)?;

            if !response.status().is_success() {
                let status = response.status().as_u16();
                let retry_after_seconds = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok());
                return Err(JiraError::Http {
                    status,
                    retryable: status == 429 || status >= 500,
                    retry_after_seconds,
                });
            }

            let page: JiraSearchPage = response
                .json()
                .await
                .map_err(|_| JiraError::InvalidResponse)?;
            page_count += 1;
            let returned = page.issues.len() as u64;
            issues.extend(page.issues);
            start_at = page.start_at.saturating_add(returned);

            if returned == 0 || start_at >= page.total {
                break;
            }
        }

        Ok(JiraSearchResult { issues, page_count })
    }
}
