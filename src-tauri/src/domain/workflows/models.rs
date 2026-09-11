use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_key: String,
    pub workflow_version: i64,
    pub status: super::state_machine::WorkflowStatus,
    pub input_json: serde_json::Value,
    pub output_json: Option<serde_json::Value>,
    pub hermes_session_id: Option<String>,
    pub hermes_run_id: Option<String>,
    pub approval_id: Option<String>,
    pub attempt: i64,
    pub error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
