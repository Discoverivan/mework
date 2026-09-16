use reqwest::{Method, Request, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use super::error::JiraError;
use super::models::JiraDeployment;
use super::planning_write::JiraPlanningTransport;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningPage<T> {
    pub values: Vec<T>,
    pub start_at: u64,
    pub max_results: u64,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub is_last: bool,
    #[serde(skip)]
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningProject {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub key: String,
    pub name: String,
    pub project_type_key: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningBoard {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub board_type: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanningSprint {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub name: String,
    pub state: String,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningIssue {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub key: String,
    pub fields: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JqlIssueSummary {
    pub key: String,
    pub summary: String,
}

#[derive(Debug, Clone, Deserialize)]
struct JqlSearchPage {
    #[serde(rename = "startAt")]
    start_at: u64,
    total: u64,
    issues: Vec<JqlIssueWire>,
}

#[derive(Debug, Clone, Deserialize)]
struct JqlIssueWire {
    key: String,
    #[serde(default)]
    fields: JqlIssueFields,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct JqlIssueFields {
    #[serde(default)]
    summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMetadata {
    pub projects: Vec<CreateMetadataProject>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMetadataProject {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub key: String,
    pub issue_types: Vec<CreateMetadataIssueType>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMetadataIssueType {
    #[serde(deserialize_with = "string_or_number")]
    pub id: String,
    pub name: String,
    pub subtask: bool,
    pub fields: serde_json::Map<String, Value>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignableUser {
    pub account_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignableUserWire {
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    key: Option<String>,
    display_name: String,
    #[serde(
        default,
        rename = "avatarUrls",
        alias = "avatarUrl",
        deserialize_with = "avatar_url_from_value"
    )]
    avatar_url: Option<String>,
    active: Option<bool>,
}

impl AssignableUserWire {
    fn into_assignable_user(self) -> Option<AssignableUser> {
        let account_id = self.account_id.or(self.name).or(self.key)?;
        if account_id.trim().is_empty() {
            return None;
        }
        Some(AssignableUser {
            account_id,
            display_name: self.display_name,
            avatar_url: self.avatar_url,
            active: self.active,
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraField {
    pub id: String,
    pub name: String,
    pub custom: Option<bool>,
    pub schema: Option<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanningCapabilities {
    pub projects: bool,
    pub boards: bool,
    pub sprints: bool,
    pub sprint_issues: bool,
    pub assignable_users: bool,
    pub fields: bool,
    pub create_metadata: &'static str,
    pub move_issues_max: Option<u32>,
    pub reason: Option<String>,
}

pub struct JiraPlanningClient {
    transport: Arc<dyn JiraPlanningTransport>,
    base_url: Url,
    deployment: JiraDeployment,
    account_key: Option<String>,
    secret: Option<String>,
}

impl JiraPlanningClient {
    pub fn new(base_url: impl AsRef<str>, deployment: JiraDeployment) -> Result<Self, JiraError> {
        let mut base_url = Url::parse(base_url.as_ref()).map_err(|_| JiraError::InvalidBaseUrl)?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(JiraError::InvalidBaseUrl);
        }
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        Ok(Self {
            transport: Arc::new(super::planning_write::ReqwestPlanningTransport::new(
                reqwest::Client::new(),
            )),
            base_url,
            deployment,
            account_key: None,
            secret: None,
        })
    }

    pub fn new_with_dependencies(
        base_url: impl AsRef<str>,
        deployment: JiraDeployment,
        transport: Arc<dyn JiraPlanningTransport>,
        account_key: Option<String>,
        secret: Option<String>,
    ) -> Result<Self, JiraError> {
        let mut client = Self::new(base_url, deployment)?;
        client.transport = transport;
        client.account_key = account_key;
        client.secret = secret;
        Ok(client)
    }

    pub fn capabilities(deployment: JiraDeployment) -> PlanningCapabilities {
        match deployment {
            JiraDeployment::Cloud => PlanningCapabilities { projects: true, boards: true, sprints: true, sprint_issues: true, assignable_users: true, fields: true, create_metadata: "deprecated", move_issues_max: Some(50), reason: None },
            JiraDeployment::DataCenter => PlanningCapabilities { projects: false, boards: false, sprints: false, sprint_issues: false, assignable_users: false, fields: false, create_metadata: "unknown", move_issues_max: None, reason: Some("selected Data Center version and authenticated read-only probe are not available".into()) },
        }
    }

    fn endpoint(&self, path: &str) -> Result<Url, JiraError> {
        self.base_url
            .join(path)
            .map_err(|_| JiraError::InvalidBaseUrl)
    }
    fn ensure_cloud(&self) -> Result<(), JiraError> {
        if self.deployment == JiraDeployment::Cloud {
            Ok(())
        } else {
            Err(JiraError::UnsupportedCapability)
        }
    }

    pub async fn list_projects(
        &self,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningProject>, JiraError> {
        self.ensure_cloud()?;
        let endpoint = self.endpoint("rest/api/3/project/search")?;
        self.paginate(endpoint, page_size, serde_json::from_value)
            .await
    }
    pub async fn get_project(&self, project_key_or_id: &str) -> Result<PlanningProject, JiraError> {
        validate_path_component(project_key_or_id)?;
        let endpoint = self.endpoint(&format!("rest/api/2/project/{project_key_or_id}"))?;
        let response = self.send(Method::GET, endpoint, None).await?;
        response
            .json()
            .await
            .map_err(|_| JiraError::InvalidResponse)
    }

    pub async fn list_boards_for_project(
        &self,
        project_key_or_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningBoard>, JiraError> {
        validate_path_component(project_key_or_id)?;
        let mut endpoint = self.endpoint("rest/agile/1.0/board")?;
        endpoint
            .query_pairs_mut()
            .append_pair("projectKeyOrId", project_key_or_id);
        self.paginate(endpoint, page_size, serde_json::from_value)
            .await
    }

    pub async fn list_boards(
        &self,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningBoard>, JiraError> {
        let endpoint = self.endpoint("rest/agile/1.0/board")?;
        self.paginate(endpoint, page_size, serde_json::from_value)
            .await
    }
    pub async fn list_sprints(
        &self,
        board_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningSprint>, JiraError> {
        validate_path_component(board_id)?;
        let endpoint = self.endpoint(&format!("rest/agile/1.0/board/{board_id}/sprint"))?;
        self.paginate(endpoint, page_size, serde_json::from_value)
            .await
    }
    pub async fn list_active_sprints(
        &self,
        board_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningSprint>, JiraError> {
        validate_path_component(board_id)?;
        let mut endpoint = self.endpoint(&format!("rest/agile/1.0/board/{board_id}/sprint"))?;
        endpoint.query_pairs_mut().append_pair("state", "active");
        self.paginate(endpoint, page_size, serde_json::from_value)
            .await
    }

    pub async fn list_usable_sprints(
        &self,
        board_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningSprint>, JiraError> {
        let mut page = self.list_sprints(board_id, page_size).await?;
        page.values
            .retain(|sprint| sprint.state.eq_ignore_ascii_case("FUTURE"));
        page.total = page.values.len() as u64;
        Ok(page)
    }

    pub async fn list_sprint_issues(
        &self,
        sprint_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<PlanningIssue>, JiraError> {
        self.list_sprint_issues_with_fields(sprint_id, page_size, None)
            .await
    }

    pub async fn list_sprint_issues_with_fields(
        &self,
        sprint_id: &str,
        page_size: u64,
        story_points_field_id: Option<&str>,
    ) -> Result<PlanningPage<PlanningIssue>, JiraError> {
        validate_path_component(sprint_id)?;
        let endpoint = self.endpoint(&format!("rest/agile/1.0/sprint/{sprint_id}/issue"))?;
        let fields = story_points_field_id.map(|field_id| {
            [
                "summary",
                "status",
                "issuetype",
                "assignee",
                "parent",
                "statuscategorychangedate",
                "updated",
                field_id,
            ]
            .join(",")
        });
        self.paginate_with_fields(endpoint, page_size, fields.as_deref(), |mut raw| {
            if let Some(object) = raw.as_object_mut() {
                if let Some(issues) = object.remove("issues") {
                    object.insert("values".into(), issues);
                }
            }
            serde_json::from_value(raw)
        })
        .await
    }

    pub async fn list_assignable_users(
        &self,
        project_key_or_id: &str,
        page_size: u64,
    ) -> Result<PlanningPage<AssignableUser>, JiraError> {
        if page_size == 0 {
            return Err(JiraError::InvalidResponse);
        }
        validate_path_component(project_key_or_id)?;
        let endpoint = self.endpoint("rest/api/2/user/assignable/search")?;
        let mut start_at = 0_u64;
        let mut page_count = 0;
        let mut values = Vec::new();
        loop {
            let request = self
                .transport
                .request(Method::GET, endpoint.clone())
                .query(&[
                    ("project", project_key_or_id),
                    ("startAt", &start_at.to_string()),
                    ("maxResults", &page_size.to_string()),
                ]);
            let response = check_response(
                self.execute(
                    self.authenticate(request)
                        .build()
                        .map_err(|_| JiraError::Transport)?,
                )
                .await?,
            )
            .await?;
            let page: Vec<AssignableUser> = response
                .json::<Vec<AssignableUserWire>>()
                .await
                .map_err(|_| JiraError::InvalidResponse)?
                .into_iter()
                .filter_map(AssignableUserWire::into_assignable_user)
                .collect();
            page_count += 1;
            let returned = page.len() as u64;
            values.extend(page);
            start_at = start_at.saturating_add(returned);
            if returned == 0 || returned < page_size {
                break;
            }
        }
        Ok(PlanningPage {
            total: values.len() as u64,
            values,
            start_at: 0,
            max_results: page_size,
            is_last: false,
            page_count,
        })
    }
    pub async fn search_assignable_users(
        &self,
        project_key_or_id: &str,
        query: &str,
        max_results: u64,
    ) -> Result<Vec<AssignableUser>, JiraError> {
        if max_results == 0 {
            return Err(JiraError::InvalidResponse);
        }
        validate_path_component(project_key_or_id)?;
        if query.trim().chars().count() < 4 {
            return Err(JiraError::InvalidResponse);
        }
        let endpoint = self.endpoint("rest/api/2/user/assignable/search")?;
        let request = self.transport.request(Method::GET, endpoint).query(&[
            ("project", project_key_or_id),
            ("username", query.trim()),
            ("startAt", "0"),
            ("maxResults", &max_results.to_string()),
        ]);
        let response = check_response(
            self.execute(
                self.authenticate(request)
                    .build()
                    .map_err(|_| JiraError::Transport)?,
            )
            .await?,
        )
        .await?;
        response
            .json::<Vec<AssignableUserWire>>()
            .await
            .map_err(|_| JiraError::InvalidResponse)
            .map(|users| {
                users
                    .into_iter()
                    .filter_map(AssignableUserWire::into_assignable_user)
                    .collect()
            })
    }

    pub async fn list_fields(&self) -> Result<Vec<JiraField>, JiraError> {
        let response = self
            .send(Method::GET, self.endpoint("rest/api/2/field")?, None)
            .await?;
        response
            .json()
            .await
            .map_err(|_| JiraError::InvalidResponse)
    }

    pub async fn get_issue(&self, issue_id_or_key: &str) -> Result<PlanningIssue, JiraError> {
        self.ensure_cloud()?;
        validate_path_component(issue_id_or_key)?;
        let endpoint = self.endpoint(&format!("rest/api/3/issue/{issue_id_or_key}"))?;
        self.send(Method::GET, endpoint, None)
            .await?
            .json()
            .await
            .map_err(|_| JiraError::InvalidResponse)
    }

    pub async fn search_issue_summaries(
        &self,
        jql: &str,
        page_size: u64,
    ) -> Result<Vec<JqlIssueSummary>, JiraError> {
        if jql.trim().is_empty() || page_size == 0 {
            return Err(JiraError::InvalidResponse);
        }

        let endpoint = self.endpoint("rest/api/2/search")?;
        let mut start_at = 0_u64;
        let mut issues = Vec::new();
        loop {
            let mut request_endpoint = endpoint.clone();
            request_endpoint
                .query_pairs_mut()
                .append_pair("jql", jql)
                .append_pair("startAt", &start_at.to_string())
                .append_pair("maxResults", &page_size.to_string())
                .append_pair("fields", "summary");
            let page: JqlSearchPage = self
                .send(Method::GET, request_endpoint, None)
                .await?
                .json()
                .await
                .map_err(|_| JiraError::InvalidResponse)?;
            let returned = page.issues.len() as u64;
            issues.extend(page.issues.into_iter().map(|issue| JqlIssueSummary {
                key: issue.key,
                summary: issue.fields.summary,
            }));
            start_at = page.start_at.saturating_add(returned);
            if returned == 0 || start_at >= page.total || returned < page_size {
                break;
            }
        }
        Ok(issues)
    }

    pub async fn list_issue_subtasks(
        &self,
        issue_id_or_key: &str,
    ) -> Result<Vec<PlanningIssue>, JiraError> {
        let issue = self.get_issue(issue_id_or_key).await?;
        issue
            .fields
            .get("subtasks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|value| serde_json::from_value(value).map_err(|_| JiraError::InvalidResponse))
            .collect()
    }

    pub async fn get_create_metadata(
        &self,
        project_id: Option<&str>,
        issue_type_id: Option<&str>,
    ) -> Result<CreateMetadata, JiraError> {
        self.ensure_cloud()?;
        let endpoint = self.endpoint("rest/api/3/issue/createmeta")?;
        let mut request = self.transport.request(Method::GET, endpoint);
        if let Some(project_id) = project_id {
            request = request.query(&[("projectIds", project_id)]);
        }
        if let Some(issue_type_id) = issue_type_id {
            request = request.query(&[("issuetypeIds", issue_type_id)]);
        }
        let request = self
            .authenticate(request)
            .build()
            .map_err(|_| JiraError::Transport)?;
        check_response(self.execute(request).await?)
            .await?
            .json()
            .await
            .map_err(|_| JiraError::InvalidResponse)
    }

    async fn paginate<T, F>(
        &self,
        endpoint: Url,
        page_size: u64,
        parse: F,
    ) -> Result<PlanningPage<T>, JiraError>
    where
        F: Fn(Value) -> Result<PlanningPage<T>, serde_json::Error> + Copy,
    {
        self.paginate_with_fields(endpoint, page_size, None, parse)
            .await
    }

    async fn paginate_with_fields<T, F>(
        &self,
        endpoint: Url,
        page_size: u64,
        fields: Option<&str>,
        parse: F,
    ) -> Result<PlanningPage<T>, JiraError>
    where
        F: Fn(Value) -> Result<PlanningPage<T>, serde_json::Error> + Copy,
    {
        if page_size == 0 {
            return Err(JiraError::InvalidResponse);
        }
        let mut start_at = 0_u64;
        let mut page_count = 0;
        let mut values = Vec::new();
        let mut total;
        loop {
            let mut request = self
                .transport
                .request(Method::GET, endpoint.clone())
                .query(&[
                    ("startAt", start_at.to_string()),
                    ("maxResults", page_size.to_string()),
                ]);
            if let Some(fields) = fields {
                request = request.query(&[("fields", fields)]);
            }
            let response = check_response(
                self.execute(
                    self.authenticate(request)
                        .build()
                        .map_err(|_| JiraError::Transport)?,
                )
                .await?,
            )
            .await?;
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(';').next())
                .unwrap_or("unknown")
                .to_owned();
            let body = response
                .text()
                .await
                .map_err(|_| JiraError::InvalidResponse)?;
            let raw: Value = serde_json::from_str(&body).map_err(|error| {
                JiraError::InvalidResponseDetails(format!(
                    "response is not valid JSON (content-type: {content_type}; parser: {error})"
                ))
            })?;
            let page: PlanningPage<T> = parse(raw).map_err(|error| {
                JiraError::InvalidResponseDetails(format!(
                    "paginated response shape is incompatible (content-type: {content_type}; parser: {error})"
                ))
            })?;
            let returned = page.values.len() as u64;
            total = page.total;
            page_count += 1;
            let is_last = page.is_last;
            values.extend(page.values);
            start_at = start_at.saturating_add(returned);
            if returned == 0 || is_last || (total > 0 && start_at >= total) || returned < page_size
            {
                break;
            }
        }
        let aggregated_total = if total > 0 {
            total
        } else {
            values.len() as u64
        };
        Ok(PlanningPage {
            values,
            start_at: 0,
            max_results: page_size,
            total: aggregated_total,
            is_last: true,
            page_count,
        })
    }

    async fn send(
        &self,
        method: Method,
        endpoint: Url,
        body: Option<Value>,
    ) -> Result<reqwest::Response, JiraError> {
        let mut request = self.transport.request(method, endpoint);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let request = self
            .authenticate(request)
            .build()
            .map_err(|_| JiraError::Transport)?;
        check_response(self.execute(request).await?).await
    }

    fn authenticate(&self, request: RequestBuilder) -> RequestBuilder {
        match (&self.account_key, &self.secret) {
            (Some(account_key), Some(secret)) if !account_key.trim().is_empty() => {
                request.basic_auth(account_key, Some(secret))
            }
            (_, Some(secret)) => request.bearer_auth(secret),
            _ => request,
        }
    }

    async fn execute(&self, request: Request) -> Result<reqwest::Response, JiraError> {
        self.transport
            .execute(request)
            .await
            .map_err(|_| JiraError::Transport)
    }
}

fn validate_path_component(value: &str) -> Result<(), JiraError> {
    if value.trim().is_empty()
        || value.contains('/')
        || value.contains('?')
        || value.contains('#')
        || value.contains('\\')
    {
        Err(JiraError::InvalidResponse)
    } else {
        Ok(())
    }
}

fn avatar_url_from_value<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    let url = match value {
        Some(Value::String(value)) => Some(value),
        Some(Value::Object(values)) => ["48x48", "32x32", "24x24", "16x16"]
            .into_iter()
            .find_map(|size| values.get(size).and_then(Value::as_str).map(str::to_owned)),
        _ => None,
    };
    Ok(url.filter(|value| !value.trim().is_empty()))
}

fn string_or_number<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(value) => Ok(value),
        Value::Number(value) => Ok(value.to_string()),
        other => Err(serde::de::Error::custom(format!(
            "expected Jira identifier string or number, got {other}"
        ))),
    }
}

async fn check_response(response: reqwest::Response) -> Result<reqwest::Response, JiraError> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status().as_u16();
    let retry_after_seconds = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok());
    Err(JiraError::Http {
        status,
        retryable: status == 429 || status >= 500,
        retry_after_seconds,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::super::planning_write::ReqwestPlanningTransport;
    use super::{JiraDeployment, JiraPlanningClient};

    #[tokio::test]
    async fn searches_issue_summaries_with_jql_and_summary_field() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/2/search"))
            .and(query_param("jql", "project = DEMO AND issuetype = Epic"))
            .and(query_param("fields", "summary"))
            .and(query_param("startAt", "0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "startAt": 0,
                "maxResults": 50,
                "total": 2,
                "issues": [
                    { "key": "DEMO-1", "fields": { "summary": "First epic" } },
                    { "key": "DEMO-2", "fields": { "summary": "Second epic" } }
                ]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = JiraPlanningClient::new_with_dependencies(
            server.uri(),
            JiraDeployment::DataCenter,
            Arc::new(ReqwestPlanningTransport::new(reqwest::Client::new())),
            None,
            Some("synthetic-secret".to_owned()),
        )
        .expect("valid Jira base URL");
        let issues = client
            .search_issue_summaries("project = DEMO AND issuetype = Epic", 50)
            .await
            .expect("JQL search should succeed");

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].key, "DEMO-1");
        assert_eq!(issues[0].summary, "First epic");
        assert_eq!(issues[1].key, "DEMO-2");
    }

    #[tokio::test]
    async fn requests_status_category_change_date_for_sprint_issues() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/rest/agile/1.0/sprint/sprint-1/issue"))
            .and(query_param("fields", "summary,status,issuetype,assignee,parent,statuscategorychangedate,updated,customfield_10016"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "startAt": 0,
                "maxResults": 100,
                "total": 0,
                "issues": []
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = JiraPlanningClient::new_with_dependencies(
            server.uri(),
            JiraDeployment::DataCenter,
            Arc::new(ReqwestPlanningTransport::new(reqwest::Client::new())),
            None,
            Some("synthetic-secret".to_owned()),
        )
        .expect("valid Jira base URL");
        let issues = client
            .list_sprint_issues_with_fields("sprint-1", 100, Some("customfield_10016"))
            .await
            .expect("sprint issue request should succeed");

        assert!(issues.values.is_empty());
    }
}
