use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JiraDeployment {
    Cloud,
    DataCenter,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JiraSearchPage {
    #[serde(rename = "startAt")]
    pub start_at: u64,
    #[serde(rename = "maxResults")]
    pub max_results: u64,
    pub total: u64,
    pub issues: Vec<JiraIssue>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JiraIssue {
    pub id: String,
    pub key: String,
    pub fields: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct JiraSearchResult {
    pub issues: Vec<JiraIssue>,
    pub page_count: u32,
}
