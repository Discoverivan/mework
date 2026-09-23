use std::time::Duration;

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

const MAX_EXCERPT_CHARS: usize = 800;

#[derive(Debug)]
pub enum ConfluenceError {
    InvalidBaseUrl,
    InvalidQuery,
    Transport,
    Http(u16, Option<serde_json::Value>),
    InvalidResponse,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSearchResult {
    pub id: String,
    pub title: String,
    pub content_type: String,
    pub space_name: Option<String>,
    pub excerpt: Option<String>,
    pub url: Option<String>,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfluenceSpace {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    content: Option<Content>,
    title: Option<String>,
    excerpt: Option<String>,
    url: Option<String>,
    result_global_container: Option<SearchContainer>,
    last_modified: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Content {
    id: String,
    title: Option<String>,
    #[serde(rename = "type")]
    content_type: Option<String>,
    space: Option<Space>,
    #[serde(rename = "_links")]
    links: Option<ContentLinks>,
}

#[derive(Debug, Deserialize)]
struct Space {
    #[serde(default)]
    id: serde_json::Value,
    #[serde(default)]
    key: String,
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContentLinks {
    webui: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchContainer {
    title: Option<String>,
}

pub struct ConfluenceClient {
    http: Client,
    base_url: Url,
    token: String,
}

impl ConfluenceClient {
    pub fn new(
        base_url: impl AsRef<str>,
        token: impl Into<String>,
        allow_insecure_tls: bool,
    ) -> Result<Self, ConfluenceError> {
        let mut base_url =
            Url::parse(base_url.as_ref()).map_err(|_| ConfluenceError::InvalidBaseUrl)?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(ConfluenceError::InvalidBaseUrl);
        }
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .danger_accept_invalid_certs(allow_insecure_tls)
            .build()
            .map_err(|_| ConfluenceError::Transport)?;
        Ok(Self {
            http,
            base_url,
            token: token.into(),
        })
    }

    pub async fn search(
        &self,
        query: &str,
        space_key: Option<&str>,
        limit: u16,
    ) -> Result<Vec<ConfluenceSearchResult>, ConfluenceError> {
        let query = query.trim();
        if query.is_empty() || query.chars().count() > 200 || !(1..=50).contains(&limit) {
            return Err(ConfluenceError::InvalidQuery);
        }
        let endpoint = self
            .base_url
            .join("rest/api/search")
            .map_err(|_| ConfluenceError::InvalidBaseUrl)?;
        let cql = match space_key.map(str::trim).filter(|value| !value.is_empty()) {
            Some(space_key) => format!(
                "space = \"{}\" AND type=page AND siteSearch ~ \"{}\"",
                escape_cql_text(space_key),
                escape_cql_text(query),
            ),
            None => format!("type=page AND siteSearch ~ \"{}\"", escape_cql_text(query)),
        };
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(&self.token)
            .query(&[
                ("cql", cql),
                ("expand", "content.space".to_owned()),
                ("limit", limit.to_string()),
            ])
            .send()
            .await
            .map_err(|_| ConfluenceError::Transport)?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body =
                crate::infrastructure::integrations::error_body::read_safe_error_body(response)
                    .await;
            return Err(ConfluenceError::Http(status, body));
        }
        let response = response
            .json::<SearchResponse>()
            .await
            .map_err(|_| ConfluenceError::InvalidResponse)?;
        Ok(response
            .results
            .into_iter()
            .filter_map(|result| normalize_result(&self.base_url, result))
            .collect())
    }

    pub async fn get_space(&self, space_key: &str) -> Result<ConfluenceSpace, ConfluenceError> {
        let space_key = space_key.trim();
        if space_key.is_empty() || space_key.chars().count() > 255 {
            return Err(ConfluenceError::InvalidQuery);
        }
        let mut endpoint = self
            .base_url
            .join("rest/api/space")
            .map_err(|_| ConfluenceError::InvalidBaseUrl)?;
        endpoint
            .path_segments_mut()
            .map_err(|_| ConfluenceError::InvalidBaseUrl)?
            .push(space_key);
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| ConfluenceError::Transport)?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body =
                crate::infrastructure::integrations::error_body::read_safe_error_body(response)
                    .await;
            return Err(ConfluenceError::Http(status, body));
        }
        let space = response
            .json::<Space>()
            .await
            .map_err(|_| ConfluenceError::InvalidResponse)?;
        let id = json_scalar_string(space.id);
        let name = space.name.filter(|value| !value.trim().is_empty());
        if id.is_none() || space.key.trim().is_empty() || name.is_none() {
            return Err(ConfluenceError::InvalidResponse);
        }
        Ok(ConfluenceSpace {
            id: id.unwrap_or_default(),
            key: space.key,
            name: plain_text(name.as_deref().unwrap_or_default(), 200),
        })
    }
}

fn json_scalar_string(value: serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) if !value.trim().is_empty() => Some(value),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn escape_cql_text(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn normalize_result(base_url: &Url, result: SearchResult) -> Option<ConfluenceSearchResult> {
    let content = result.content?;
    let title = content.title.or(result.title)?;
    let raw_url = result.url.as_deref().or_else(|| {
        content
            .links
            .as_ref()
            .and_then(|links| links.webui.as_deref())
    });
    let space_name = content.space.and_then(|space| space.name).or_else(|| {
        result
            .result_global_container
            .and_then(|container| container.title)
    });
    Some(ConfluenceSearchResult {
        id: content.id,
        title: plain_text(&title, 300),
        content_type: content.content_type.unwrap_or_else(|| "page".to_owned()),
        space_name: space_name.map(|value| plain_text(&value, 200)),
        excerpt: result
            .excerpt
            .map(|value| plain_text(&value, MAX_EXCERPT_CHARS))
            .filter(|value| !value.is_empty()),
        url: raw_url.and_then(|value| same_origin_url(base_url, value)),
        last_modified: result.last_modified,
    })
}

fn same_origin_url(base_url: &Url, value: &str) -> Option<String> {
    let url = base_url.join(value).ok()?;
    if url.scheme() != base_url.scheme()
        || url.host_str() != base_url.host_str()
        || url.port_or_known_default() != base_url.port_or_known_default()
    {
        return None;
    }
    Some(url.to_string())
}

fn plain_text(value: &str, max_chars: usize) -> String {
    let value = value.replace("@@@hl@@@", "").replace("@@@endhl@@@", "");
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag && output.chars().count() < max_chars => output.push(character),
            _ => {}
        }
    }
    output
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
