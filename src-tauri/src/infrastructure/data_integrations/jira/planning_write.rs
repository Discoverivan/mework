use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use reqwest::{Method, Request, RequestBuilder, Url};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::models::JiraDeployment;

pub const MOVE_ISSUES_PROVIDER_LIMIT: usize = 50;

type TransportFuture =
    Pin<Box<dyn Future<Output = Result<reqwest::Response, reqwest::Error>> + Send>>;

/// The network boundary is injected so this adapter has no implicit client or endpoint.
/// Production code supplies its transport; tests use `ReqwestPlanningTransport` with Wiremock.
pub trait JiraPlanningTransport: Send + Sync {
    fn request(&self, method: Method, url: Url) -> RequestBuilder;
    fn execute(&self, request: Request) -> TransportFuture;
}

pub struct ReqwestPlanningTransport {
    client: reqwest::Client,
}

impl ReqwestPlanningTransport {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }
}

impl JiraPlanningTransport for ReqwestPlanningTransport {
    fn request(&self, method: Method, url: Url) -> RequestBuilder {
        self.client.request(method, url)
    }

    fn execute(&self, request: Request) -> TransportFuture {
        let client = self.client.clone();
        Box::pin(async move { client.execute(request).await })
    }
}

/// Authentication stays outside the adapter. A keyring-backed implementation should add
/// its header here; the adapter never receives, stores, logs, or serializes the secret.
pub trait JiraRequestAuthenticator: Send + Sync {
    fn authenticate(
        &self,
        request: RequestBuilder,
    ) -> Result<RequestBuilder, JiraPlanningWriteError>;
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum JiraWriteErrorKind {
    AuthenticationRequired,
    PermissionDenied,
    NotFound,
    RateLimited,
    ValidationFailed,
    RemoteConflict,
    Timeout,
    UnsupportedCapability,
    Transport,
    InvalidRequest,
    InvalidResponse,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct JiraPlanningWriteError {
    kind: JiraWriteErrorKind,
    status: Option<u16>,
    retry_after_seconds: Option<u64>,
    completed_issue_ids: Vec<String>,
}

impl JiraPlanningWriteError {
    fn new(kind: JiraWriteErrorKind) -> Self {
        Self {
            kind,
            status: None,
            retry_after_seconds: None,
            completed_issue_ids: Vec::new(),
        }
    }

    fn http(status: u16, retry_after_seconds: Option<u64>) -> Self {
        let kind = match status {
            401 => JiraWriteErrorKind::AuthenticationRequired,
            403 => JiraWriteErrorKind::PermissionDenied,
            404 => JiraWriteErrorKind::NotFound,
            408 => JiraWriteErrorKind::Timeout,
            409 => JiraWriteErrorKind::RemoteConflict,
            422 => JiraWriteErrorKind::ValidationFailed,
            429 => JiraWriteErrorKind::RateLimited,
            400..=499 => JiraWriteErrorKind::ValidationFailed,
            _ => JiraWriteErrorKind::Transport,
        };
        Self {
            kind,
            status: Some(status),
            retry_after_seconds,
            completed_issue_ids: Vec::new(),
        }
    }

    fn with_completed_issue_ids(mut self, issue_ids: &[String]) -> Self {
        self.completed_issue_ids = issue_ids.to_vec();
        self
    }

    pub fn kind(&self) -> JiraWriteErrorKind {
        self.kind
    }

    pub fn status(&self) -> Option<u16> {
        self.status
    }

    pub fn retry_after_seconds(&self) -> Option<u64> {
        self.retry_after_seconds
    }

    /// IDs acknowledged by earlier move chunks before a later chunk failed.
    pub fn completed_issue_ids(&self) -> &[String] {
        &self.completed_issue_ids
    }

    pub fn is_retryable(&self) -> bool {
        matches!(
            self.kind,
            JiraWriteErrorKind::RateLimited
                | JiraWriteErrorKind::Timeout
                | JiraWriteErrorKind::Transport
        )
    }
}

impl std::fmt::Display for JiraPlanningWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.kind {
            JiraWriteErrorKind::AuthenticationRequired => {
                f.write_str("Jira authentication is required")
            }
            JiraWriteErrorKind::PermissionDenied => f.write_str("Jira permission denied"),
            JiraWriteErrorKind::NotFound => f.write_str("Jira object was not found"),
            JiraWriteErrorKind::RateLimited => f.write_str("Jira rate limit exceeded"),
            JiraWriteErrorKind::ValidationFailed => f.write_str("Jira validation failed"),
            JiraWriteErrorKind::RemoteConflict => f.write_str("Jira remote conflict"),
            JiraWriteErrorKind::Timeout => f.write_str("Jira request timed out"),
            JiraWriteErrorKind::UnsupportedCapability => {
                f.write_str("Jira capability is not supported")
            }
            JiraWriteErrorKind::Transport => f.write_str("Jira transport error"),
            JiraWriteErrorKind::InvalidRequest => f.write_str("invalid Jira write request"),
            JiraWriteErrorKind::InvalidResponse => f.write_str("invalid Jira write response"),
        }
    }
}

impl std::error::Error for JiraPlanningWriteError {}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct JiraIssueIdentity {
    pub id: String,
    pub key: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct MoveIssuesChunk {
    pub issue_ids: Vec<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct MoveIssuesResult {
    pub sprint_id: String,
    pub moved_issue_ids: Vec<String>,
    pub chunk_count: usize,
    pub chunks: Vec<MoveIssuesChunk>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct UpdatedIssueIdentity {
    pub issue_id_or_key: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CreatedSubtaskIdentity {
    pub issue: JiraIssueIdentity,
    pub parent_issue_id_or_key: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct UpdatedSubtaskIdentity {
    pub issue_id_or_key: String,
    pub parent_issue_id_or_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssueUpdate {
    /// `None` leaves assignee unchanged; `Some(None)` clears it.
    pub assignee_account_id: Option<Option<String>>,
    pub fields: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CreateSubtaskRequest {
    pub parent_issue_id_or_key: String,
    pub project_id: String,
    pub issue_type_id: String,
    pub summary: String,
    pub fields: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteFieldValidation {
    pub allowed_fields: BTreeSet<String>,
    pub required_fields: BTreeSet<String>,
}

pub struct JiraPlanningWriteClient {
    transport: Arc<dyn JiraPlanningTransport>,
    authenticator: Arc<dyn JiraRequestAuthenticator>,
    base_url: Url,
    deployment: JiraDeployment,
}

impl JiraPlanningWriteClient {
    pub fn new(
        base_url: impl AsRef<str>,
        transport: Arc<dyn JiraPlanningTransport>,
        authenticator: Arc<dyn JiraRequestAuthenticator>,
        deployment: JiraDeployment,
    ) -> Result<Self, JiraPlanningWriteError> {
        let mut base_url = Url::parse(base_url.as_ref())
            .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidRequest))?;
        if !matches!(base_url.scheme(), "http" | "https")
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(JiraPlanningWriteError::new(
                JiraWriteErrorKind::InvalidRequest,
            ));
        }
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        Ok(Self {
            transport,
            authenticator,
            base_url,
            deployment,
        })
    }

    pub async fn move_issues_to_sprint(
        &self,
        sprint_id: &str,
        issue_ids: &[String],
    ) -> Result<MoveIssuesResult, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        validate_path_component(sprint_id)?;
        if issue_ids.is_empty() {
            return Err(validation_error());
        }
        let mut seen = BTreeSet::new();
        for issue_id in issue_ids {
            validate_path_component(issue_id)?;
            if !seen.insert(issue_id) {
                return Err(validation_error());
            }
        }

        let mut completed = Vec::new();
        let mut chunks = Vec::new();
        for issue_chunk in issue_ids.chunks(MOVE_ISSUES_PROVIDER_LIMIT) {
            let chunk = issue_chunk.to_vec();
            let endpoint =
                self.endpoint(&["rest", "agile", "1.0", "sprint", sprint_id, "issue"])?;
            let body = serde_json::json!({ "issues": chunk });
            if let Err(error) = self
                .send_no_content(Method::POST, endpoint, Some(body))
                .await
            {
                return Err(error.with_completed_issue_ids(&completed));
            }
            completed.extend(issue_chunk.iter().cloned());
            chunks.push(MoveIssuesChunk { issue_ids: chunk });
        }
        Ok(MoveIssuesResult {
            sprint_id: sprint_id.to_owned(),
            moved_issue_ids: completed,
            chunk_count: chunks.len(),
            chunks,
        })
    }

    pub async fn issue_exists(
        &self,
        issue_id_or_key: &str,
    ) -> Result<bool, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        validate_path_component(issue_id_or_key)?;
        let endpoint = self.endpoint(&["rest", "api", "3", "issue", issue_id_or_key])?;
        self.send(Method::GET, endpoint, None).await.map(|_| true)
    }

    pub async fn issue_in_sprint(
        &self,
        sprint_id: &str,
        issue_id_or_key: &str,
    ) -> Result<bool, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        validate_path_component(sprint_id)?;
        validate_path_component(issue_id_or_key)?;
        let endpoint = self.endpoint(&["rest", "agile", "1.0", "sprint", sprint_id, "issue"])?;
        let response = self.send(Method::GET, endpoint, None).await?;
        let body: Value = response
            .json()
            .await
            .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidResponse))?;
        let issues = body
            .get("issues")
            .or_else(|| body.get("values"))
            .and_then(Value::as_array)
            .ok_or_else(|| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidResponse))?;
        Ok(issues.iter().any(|issue| {
            issue.get("id").and_then(Value::as_str) == Some(issue_id_or_key)
                || issue.get("key").and_then(Value::as_str) == Some(issue_id_or_key)
        }))
    }

    pub async fn subtask_exists(
        &self,
        parent_issue_id_or_key: &str,
        summary: &str,
    ) -> Result<Option<String>, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        validate_path_component(parent_issue_id_or_key)?;
        validate_nonempty_text(summary)?;
        let endpoint = self.endpoint(&["rest", "api", "3", "issue", parent_issue_id_or_key])?;
        let response = self.send(Method::GET, endpoint, None).await?;
        let body: Value = response
            .json()
            .await
            .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidResponse))?;
        Ok(body
            .pointer("/fields/subtasks")
            .and_then(Value::as_array)
            .and_then(|subtasks| {
                subtasks.iter().find(|subtask| {
                    subtask.pointer("/fields/summary").and_then(Value::as_str) == Some(summary)
                })
            })
            .and_then(|subtask| {
                subtask
                    .get("id")
                    .and_then(Value::as_str)
                    .or_else(|| subtask.get("key").and_then(Value::as_str))
                    .map(str::to_owned)
            }))
    }

    pub async fn update_issue(
        &self,
        issue_id_or_key: &str,
        update: IssueUpdate,
        allowed_fields: &BTreeSet<String>,
    ) -> Result<UpdatedIssueIdentity, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        validate_path_component(issue_id_or_key)?;
        let body = issue_update_body(&update, allowed_fields)?;
        let endpoint = self.endpoint(&["rest", "api", "3", "issue", issue_id_or_key])?;
        self.send_no_content(Method::PUT, endpoint, Some(body))
            .await?;
        Ok(UpdatedIssueIdentity {
            issue_id_or_key: issue_id_or_key.to_owned(),
        })
    }

    pub async fn create_subtask(
        &self,
        request: CreateSubtaskRequest,
        validation: &WriteFieldValidation,
    ) -> Result<CreatedSubtaskIdentity, JiraPlanningWriteError> {
        self.ensure_cloud()?;
        let body = subtask_create_body(&request, validation)?;
        let endpoint = self.endpoint(&["rest", "api", "3", "issue"])?;
        let response = self.send(Method::POST, endpoint, Some(body)).await?;
        let created: CreateIssueResponse = response
            .json()
            .await
            .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidResponse))?;
        let issue = JiraIssueIdentity {
            id: created.id,
            key: created.key,
        };
        if issue.id.is_empty() || issue.key.is_empty() {
            return Err(JiraPlanningWriteError::new(
                JiraWriteErrorKind::InvalidResponse,
            ));
        }
        Ok(CreatedSubtaskIdentity {
            issue,
            parent_issue_id_or_key: request.parent_issue_id_or_key,
        })
    }

    pub async fn update_subtask(
        &self,
        issue_id_or_key: &str,
        parent_issue_id_or_key: &str,
        update: IssueUpdate,
        allowed_fields: &BTreeSet<String>,
    ) -> Result<UpdatedSubtaskIdentity, JiraPlanningWriteError> {
        validate_path_component(parent_issue_id_or_key)?;
        let issue = self
            .update_issue(issue_id_or_key, update, allowed_fields)
            .await?;
        Ok(UpdatedSubtaskIdentity {
            issue_id_or_key: issue.issue_id_or_key,
            parent_issue_id_or_key: parent_issue_id_or_key.to_owned(),
        })
    }

    fn ensure_cloud(&self) -> Result<(), JiraPlanningWriteError> {
        if self.deployment == JiraDeployment::Cloud {
            Ok(())
        } else {
            Err(JiraPlanningWriteError::new(
                JiraWriteErrorKind::UnsupportedCapability,
            ))
        }
    }

    fn endpoint(&self, segments: &[&str]) -> Result<Url, JiraPlanningWriteError> {
        let mut endpoint = self.base_url.clone();
        let normalized_base_path = endpoint.path().trim_end_matches('/').to_owned();
        endpoint.set_path(if normalized_base_path.is_empty() {
            "/"
        } else {
            &normalized_base_path
        });
        {
            let mut path = endpoint
                .path_segments_mut()
                .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidRequest))?;
            for segment in segments {
                validate_path_component(segment)?;
                path.push(segment);
            }
        }
        endpoint.set_query(None);
        endpoint.set_fragment(None);
        Ok(endpoint)
    }

    async fn send(
        &self,
        method: Method,
        endpoint: Url,
        body: Option<Value>,
    ) -> Result<reqwest::Response, JiraPlanningWriteError> {
        let mut request = self.transport.request(method, endpoint);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let request = self
            .authenticator
            .authenticate(request)?
            .build()
            .map_err(|_| JiraPlanningWriteError::new(JiraWriteErrorKind::InvalidRequest))?;
        let response = self.transport.execute(request).await.map_err(|error| {
            if error.is_timeout() {
                JiraPlanningWriteError::new(JiraWriteErrorKind::Timeout)
            } else {
                JiraPlanningWriteError::new(JiraWriteErrorKind::Transport)
            }
        })?;
        if response.status().is_success() {
            Ok(response)
        } else {
            let retry_after_seconds = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            Err(JiraPlanningWriteError::http(
                response.status().as_u16(),
                retry_after_seconds,
            ))
        }
    }

    async fn send_no_content(
        &self,
        method: Method,
        endpoint: Url,
        body: Option<Value>,
    ) -> Result<(), JiraPlanningWriteError> {
        self.send(method, endpoint, body).await.map(|_| ())
    }
}

fn issue_update_body(
    update: &IssueUpdate,
    allowed_fields: &BTreeSet<String>,
) -> Result<Value, JiraPlanningWriteError> {
    if update.assignee_account_id.is_none() && update.fields.is_empty() {
        return Err(validation_error());
    }
    let mut fields = Map::new();
    if let Some(account_id) = &update.assignee_account_id {
        require_allowed("assignee", allowed_fields)?;
        if let Some(account_id) = account_id {
            validate_nonempty_text(account_id)?;
        }
        fields.insert(
            "assignee".into(),
            account_id
                .as_ref()
                .map(|account_id| serde_json::json!({ "accountId": account_id }))
                .unwrap_or(Value::Null),
        );
    }
    validate_user_fields(&update.fields, allowed_fields)?;
    for (field_id, value) in &update.fields {
        fields.insert(field_id.clone(), value.clone());
    }
    Ok(Value::Object(Map::from_iter([(
        "fields".into(),
        Value::Object(fields),
    )])))
}

fn subtask_create_body(
    request: &CreateSubtaskRequest,
    validation: &WriteFieldValidation,
) -> Result<Value, JiraPlanningWriteError> {
    validate_path_component(&request.parent_issue_id_or_key)?;
    validate_path_component(&request.project_id)?;
    validate_path_component(&request.issue_type_id)?;
    if request.summary.trim().is_empty() {
        return Err(validation_error());
    }
    validate_user_fields(&request.fields, &validation.allowed_fields)?;
    for required_field in &validation.required_fields {
        if !matches!(
            required_field.as_str(),
            "project" | "issuetype" | "parent" | "summary"
        ) && !request.fields.contains_key(required_field)
        {
            return Err(validation_error());
        }
    }
    let mut fields = Map::from_iter([
        (
            "project".into(),
            serde_json::json!({ "id": request.project_id }),
        ),
        (
            "issuetype".into(),
            serde_json::json!({ "id": request.issue_type_id }),
        ),
        (
            "parent".into(),
            parent_reference(&request.parent_issue_id_or_key),
        ),
        ("summary".into(), Value::String(request.summary.clone())),
    ]);
    for (field_id, value) in &request.fields {
        fields.insert(field_id.clone(), value.clone());
    }
    Ok(Value::Object(Map::from_iter([(
        "fields".into(),
        Value::Object(fields),
    )])))
}

fn parent_reference(parent: &str) -> Value {
    if parent.chars().all(|character| character.is_ascii_digit()) {
        serde_json::json!({ "id": parent })
    } else {
        serde_json::json!({ "key": parent })
    }
}

fn validate_user_fields(
    fields: &BTreeMap<String, Value>,
    allowed_fields: &BTreeSet<String>,
) -> Result<(), JiraPlanningWriteError> {
    for field_id in fields.keys() {
        validate_field_id(field_id)?;
        require_allowed(field_id, allowed_fields)?;
        if matches!(
            field_id.as_str(),
            "project" | "issuetype" | "parent" | "summary" | "assignee"
        ) {
            return Err(validation_error());
        }
    }
    Ok(())
}

fn require_allowed(
    field_id: &str,
    allowed_fields: &BTreeSet<String>,
) -> Result<(), JiraPlanningWriteError> {
    if allowed_fields.contains(field_id) {
        Ok(())
    } else {
        Err(validation_error())
    }
}

fn validate_field_id(field_id: &str) -> Result<(), JiraPlanningWriteError> {
    if field_id.is_empty()
        || field_id
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '?' | '#'))
    {
        Err(validation_error())
    } else {
        Ok(())
    }
}

fn validate_nonempty_text(value: &str) -> Result<(), JiraPlanningWriteError> {
    if value.is_empty() || value.chars().any(char::is_control) {
        Err(validation_error())
    } else {
        Ok(())
    }
}

fn validate_path_component(value: &str) -> Result<(), JiraPlanningWriteError> {
    if value.is_empty()
        || matches!(value, "." | "..")
        || value
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | '?' | '#'))
    {
        Err(validation_error())
    } else {
        Ok(())
    }
}

fn validation_error() -> JiraPlanningWriteError {
    JiraPlanningWriteError::new(JiraWriteErrorKind::ValidationFailed)
}

#[derive(Debug, Deserialize)]
struct CreateIssueResponse {
    id: String,
    key: String,
}

impl JiraPlanningWriteClient {
    #[allow(dead_code)]
    pub fn deployment(&self) -> JiraDeployment {
        self.deployment
    }
}
