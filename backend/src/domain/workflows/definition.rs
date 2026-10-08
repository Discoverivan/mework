use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDefinition {
    pub key: String,
    pub version: i64,
    pub skill_key: String,
    pub input_schema_json: serde_json::Value,
    pub output_schema_json: serde_json::Value,
    pub policy_json: serde_json::Value,
}
