pub use crate::domain::planning::state_machine::{
    PlanningState, PlanningStateMachine, StateMachineError,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const DEFAULT_MOVE_CHUNK_SIZE: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParentDraft {
    pub issue_id: String,
    pub source_sprint_id: String,
    pub target_sprint_id: String,
    pub assignee_account_id: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskDraft {
    pub remote_subtask_id: Option<String>,
    pub parent_issue_id: String,
    pub competency_key: String,
    pub summary: String,
    pub story_points: Option<i64>,
    pub assignee_account_id: Option<String>,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldUpdateDraft {
    pub issue_id: String,
    pub field_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanningDraft {
    pub parents: Vec<ParentDraft>,
    pub subtasks: Vec<SubtaskDraft>,
    pub field_updates: Vec<FieldUpdateDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub workspace_id: String,
    pub expected_revision: i64,
    pub expected_remote_revision: Option<String>,
    pub confirm: bool,
    pub idempotency_key: String,
    pub draft: PlanningDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PlannedOperation {
    MoveIssue {
        issue_id: String,
        source_sprint_id: String,
        target_sprint_id: String,
    },
    UpdateParentAssignee {
        issue_id: String,
        account_id: String,
    },
    CreateSubtask {
        parent_issue_id: String,
        competency_key: String,
        summary: String,
        story_points: Option<i64>,
        assignee_account_id: Option<String>,
    },
    UpdateSubtask {
        remote_subtask_id: String,
        parent_issue_id: String,
        competency_key: String,
        summary: String,
        story_points: Option<i64>,
        assignee_account_id: Option<String>,
    },
    UpdateField {
        issue_id: String,
        field_id: String,
        value: String,
    },
}

impl PlannedOperation {
    pub fn operation_type(&self) -> &'static str {
        match self {
            Self::MoveIssue { .. } => "move_issue",
            Self::UpdateParentAssignee { .. } => "update_parent_assignee",
            Self::CreateSubtask { .. } => "create_subtask",
            Self::UpdateSubtask { .. } => "update_subtask",
            Self::UpdateField { .. } => "update_field",
        }
    }

    pub fn operation_id(&self) -> String {
        format!(
            "op-{:016x}",
            stable_hash(&serde_json::to_string(self).unwrap_or_default())
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct OperationBatch {
    pub index: usize,
    pub operations: Vec<PlannedOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct OperationPlan {
    pub batches: Vec<OperationBatch>,
    pub request_hash: String,
}

/// The metadata/permission facts obtained from Jira before an apply.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Eq, PartialEq)]
pub struct WriteCapabilities {
    pub can_move_issues: bool,
    pub can_edit_issues: bool,
    pub can_create_subtasks: bool,
    pub move_issues_max: Option<usize>,
    pub editable_field_ids: BTreeSet<String>,
}

pub trait JiraPlanningWriteAdapter {
    fn capabilities(&self) -> &WriteCapabilities;
    fn write(&mut self, operation: &PlannedOperation) -> Result<RemoteWrite, WriteError>;
    /// Writes one logical batch. The default keeps adapters source-compatible while allowing
    /// the Jira adapter to use the provider's 50-item move endpoint limit.
    fn write_batch(
        &mut self,
        operations: &[PlannedOperation],
    ) -> Vec<Result<RemoteWrite, WriteError>> {
        operations
            .iter()
            .map(|operation| self.write(operation))
            .collect()
    }
    /// Reconciliation is mandatory after an ambiguous write; it must not retry the write.
    fn reconcile(&mut self, operation: &PlannedOperation) -> Reconciliation;
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RemoteWrite {
    pub remote_reference: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum Reconciliation {
    Applied { remote_reference: String },
    NotApplied,
    Unknown,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum WriteError {
    PermissionDenied,
    Validation,
    RemoteConflict,
    Timeout,
    Ambiguous,
    Unavailable,
    Transport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OperationResultStatus {
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RedactedOperationResult {
    pub operation_id: String,
    pub operation_type: String,
    pub status: OperationResultStatus,
    pub remote_reference: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub workspace_id: String,
    pub state: PlanningState,
    pub revision: i64,
    pub duplicate: bool,
    pub operation_results: Vec<RedactedOperationResult>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum SyncError {
    ConfirmationRequired,
    MissingIdempotencyKey,
    InvalidInput,
    CapabilityUnavailable,
    PermissionDenied,
    MetadataValidation,
    IdempotencyConflict,
    StaleRevision { expected: i64, actual: i64 },
    StaleRemoteRevision,
    InvalidState,
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ConfirmationRequired => "explicit confirmation is required",
            Self::MissingIdempotencyKey => "a local idempotency key is required",
            Self::InvalidInput => "invalid planning apply input",
            Self::CapabilityUnavailable => "Jira planning write capability is unavailable",
            Self::PermissionDenied => "Jira planning write permission denied",
            Self::MetadataValidation => "Jira planning metadata validation failed",
            Self::IdempotencyConflict => "idempotency key was already used for another request",
            Self::StaleRevision { .. } => "stale planning revision",
            Self::StaleRemoteRevision => "stale Jira planning revision",
            Self::InvalidState => "planning workspace is not applicable in its current state",
        })
    }
}

impl std::error::Error for SyncError {}

pub fn plan_operations(
    draft: &PlanningDraft,
    move_chunk_size: usize,
) -> Result<OperationPlan, SyncError> {
    if move_chunk_size == 0 {
        return Err(SyncError::CapabilityUnavailable);
    }

    let mut parents = draft
        .parents
        .iter()
        .filter(|parent| parent.selected)
        .collect::<Vec<_>>();
    if parents.iter().any(|parent| {
        parent.issue_id.trim().is_empty()
            || parent.source_sprint_id.trim().is_empty()
            || parent.target_sprint_id.trim().is_empty()
            || parent
                .assignee_account_id
                .as_deref()
                .is_some_and(|account_id| account_id.trim().is_empty())
    }) {
        return Err(SyncError::InvalidInput);
    }
    let mut parent_ids = BTreeSet::new();
    if parents
        .iter()
        .any(|parent| !parent_ids.insert(parent.issue_id.as_str()))
    {
        return Err(SyncError::InvalidInput);
    }
    parents.sort_by(|left, right| left.issue_id.cmp(&right.issue_id));

    let moves = parents
        .iter()
        .filter(|parent| parent.source_sprint_id != parent.target_sprint_id)
        .map(|parent| PlannedOperation::MoveIssue {
            issue_id: parent.issue_id.clone(),
            source_sprint_id: parent.source_sprint_id.clone(),
            target_sprint_id: parent.target_sprint_id.clone(),
        })
        .collect::<Vec<_>>();

    let mut other_operations = Vec::new();
    for parent in parents {
        if let Some(account_id) = &parent.assignee_account_id {
            if !account_id.is_empty() {
                other_operations.push(PlannedOperation::UpdateParentAssignee {
                    issue_id: parent.issue_id.clone(),
                    account_id: account_id.clone(),
                });
            }
        }
    }

    let mut subtasks = draft
        .subtasks
        .iter()
        .filter(|subtask| subtask.required)
        .collect::<Vec<_>>();
    subtasks.sort_by(|left, right| {
        (
            &left.parent_issue_id,
            &left.competency_key,
            &left.remote_subtask_id,
            &left.summary,
        )
            .cmp(&(
                &right.parent_issue_id,
                &right.competency_key,
                &right.remote_subtask_id,
                &right.summary,
            ))
    });
    for subtask in subtasks {
        if subtask.parent_issue_id.trim().is_empty()
            || subtask.summary.trim().is_empty()
            || subtask.competency_key.trim().is_empty()
            || subtask
                .assignee_account_id
                .as_deref()
                .is_some_and(|account_id| account_id.trim().is_empty())
            || subtask
                .story_points
                .is_some_and(|points| !(0..=100).contains(&points))
        {
            return Err(SyncError::InvalidInput);
        }
        other_operations.push(match &subtask.remote_subtask_id {
            Some(remote_subtask_id) => PlannedOperation::UpdateSubtask {
                remote_subtask_id: remote_subtask_id.clone(),
                parent_issue_id: subtask.parent_issue_id.clone(),
                competency_key: subtask.competency_key.clone(),
                summary: subtask.summary.clone(),
                story_points: subtask.story_points,
                assignee_account_id: subtask.assignee_account_id.clone(),
            },
            None => PlannedOperation::CreateSubtask {
                parent_issue_id: subtask.parent_issue_id.clone(),
                competency_key: subtask.competency_key.clone(),
                summary: subtask.summary.clone(),
                story_points: subtask.story_points,
                assignee_account_id: subtask.assignee_account_id.clone(),
            },
        });
    }

    let mut fields = draft.field_updates.iter().collect::<Vec<_>>();
    if fields
        .iter()
        .any(|field| field.issue_id.trim().is_empty() || field.field_id.trim().is_empty())
    {
        return Err(SyncError::InvalidInput);
    }
    fields.sort_by(|left, right| {
        (&left.issue_id, &left.field_id).cmp(&(&right.issue_id, &right.field_id))
    });
    other_operations.extend(
        fields
            .into_iter()
            .map(|field| PlannedOperation::UpdateField {
                issue_id: field.issue_id.clone(),
                field_id: field.field_id.clone(),
                value: field.value.clone(),
            }),
    );

    let mut batches = Vec::new();
    for chunk in moves.chunks(move_chunk_size) {
        batches.push(OperationBatch {
            index: batches.len(),
            operations: chunk.to_vec(),
        });
    }
    for operation in other_operations {
        batches.push(OperationBatch {
            index: batches.len(),
            operations: vec![operation],
        });
    }

    let operations = batches
        .iter()
        .flat_map(|batch| batch.operations.iter())
        .collect::<Vec<_>>();
    let serialized = serde_json::to_string(&operations).map_err(|_| SyncError::InvalidInput)?;
    Ok(OperationPlan {
        batches,
        request_hash: format!("{:016x}", stable_hash(&serialized)),
    })
}

fn validate_plan(plan: &OperationPlan, capabilities: &WriteCapabilities) -> Result<(), SyncError> {
    let move_count = plan
        .batches
        .iter()
        .flat_map(|batch| batch.operations.iter())
        .filter(|operation| matches!(operation, PlannedOperation::MoveIssue { .. }))
        .count();
    if move_count > 0 {
        if !capabilities.can_move_issues {
            return Err(SyncError::PermissionDenied);
        }
        if capabilities.move_issues_max.unwrap_or(0) == 0 {
            return Err(SyncError::CapabilityUnavailable);
        }
    }
    for operation in plan
        .batches
        .iter()
        .flat_map(|batch| batch.operations.iter())
    {
        match operation {
            PlannedOperation::MoveIssue { .. } => {}
            PlannedOperation::UpdateParentAssignee { .. }
            | PlannedOperation::UpdateSubtask { .. }
            | PlannedOperation::UpdateField { .. }
                if !capabilities.can_edit_issues =>
            {
                return Err(SyncError::PermissionDenied);
            }
            PlannedOperation::CreateSubtask { .. } if !capabilities.can_create_subtasks => {
                return Err(SyncError::PermissionDenied);
            }
            PlannedOperation::UpdateField { field_id, .. }
                if !capabilities.editable_field_ids.contains(field_id) =>
            {
                return Err(SyncError::MetadataValidation);
            }
            _ => {}
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct LedgerEntry {
    workspace_id: String,
    request_hash: String,
    result: ApplyResult,
}

#[derive(Debug, Clone)]
pub struct SyncCoordinator {
    machine: PlanningStateMachine,
    ledger: BTreeMap<String, LedgerEntry>,
}

impl SyncCoordinator {
    pub fn new(machine: PlanningStateMachine) -> Self {
        Self {
            machine,
            ledger: BTreeMap::new(),
        }
    }

    pub fn state(&self) -> PlanningState {
        self.machine.state()
    }

    pub fn revision(&self) -> i64 {
        self.machine.revision()
    }

    pub fn apply(
        &mut self,
        request: ApplyRequest,
        adapter: Option<&mut dyn JiraPlanningWriteAdapter>,
    ) -> Result<ApplyResult, SyncError> {
        validate_request(&request)?;
        let move_limit = adapter
            .as_ref()
            .and_then(|value| value.capabilities().move_issues_max)
            .unwrap_or(DEFAULT_MOVE_CHUNK_SIZE);
        let plan = plan_operations(&request.draft, move_limit)?;

        if let Some(entry) = self.ledger.get(&request.idempotency_key) {
            if entry.workspace_id != request.workspace_id || entry.request_hash != plan.request_hash
            {
                return Err(SyncError::IdempotencyConflict);
            }
            let mut result = entry.result.clone();
            result.duplicate = true;
            return Ok(result);
        }

        let adapter = adapter.ok_or(SyncError::CapabilityUnavailable)?;
        validate_plan(&plan, adapter.capabilities())?;
        if let Err(error) = self.machine.begin_apply(
            request.expected_revision,
            request.expected_remote_revision.as_deref(),
        ) {
            if matches!(error, StateMachineError::StaleRemoteRevision { .. }) {
                let _ = self
                    .machine
                    .detect_remote_conflict(request.expected_remote_revision.as_deref());
            }
            return Err(map_state_error(error));
        }

        let mut operation_results = Vec::new();
        for batch in &plan.batches {
            let writes = adapter.write_batch(&batch.operations);
            if writes.len() != batch.operations.len() {
                operation_results.extend(batch.operations.iter().map(|operation| {
                    RedactedOperationResult {
                        operation_id: operation.operation_id(),
                        operation_type: operation.operation_type().into(),
                        status: OperationResultStatus::Unknown,
                        remote_reference: None,
                        error: Some("adapter_protocol_error".into()),
                    }
                }));
                continue;
            }
            for (operation, write) in batch.operations.iter().zip(writes) {
                operation_results.push(execute_operation(adapter, operation, write));
            }
        }

        let all_succeeded = operation_results
            .iter()
            .all(|result| result.status == OperationResultStatus::Succeeded);
        let transition_revision = self.machine.revision();
        if all_succeeded {
            self.machine
                .finish_success(transition_revision)
                .map_err(map_state_error)?;
        } else {
            self.machine
                .finish_partial(transition_revision)
                .map_err(map_state_error)?;
        }

        let result = ApplyResult {
            workspace_id: request.workspace_id.clone(),
            state: self.machine.state(),
            revision: self.machine.revision(),
            duplicate: false,
            operation_results,
        };
        self.ledger.insert(
            request.idempotency_key,
            LedgerEntry {
                workspace_id: request.workspace_id,
                request_hash: plan.request_hash,
                result: result.clone(),
            },
        );
        Ok(result)
    }
}

fn validate_request(request: &ApplyRequest) -> Result<(), SyncError> {
    if !request.confirm {
        return Err(SyncError::ConfirmationRequired);
    }
    if request.idempotency_key.trim().is_empty() {
        return Err(SyncError::MissingIdempotencyKey);
    }
    if request.workspace_id.trim().is_empty() || request.expected_revision < 0 {
        return Err(SyncError::InvalidInput);
    }
    Ok(())
}

fn execute_operation(
    adapter: &mut dyn JiraPlanningWriteAdapter,
    operation: &PlannedOperation,
    write: Result<RemoteWrite, WriteError>,
) -> RedactedOperationResult {
    let (status, remote_reference, error) = match write {
        Ok(result) => (
            OperationResultStatus::Succeeded,
            result
                .remote_reference
                .as_deref()
                .and_then(redact_remote_reference),
            None,
        ),
        Err(WriteError::Timeout | WriteError::Ambiguous) => match adapter.reconcile(operation) {
            Reconciliation::Applied { remote_reference } => (
                OperationResultStatus::Succeeded,
                redact_remote_reference(&remote_reference),
                None,
            ),
            Reconciliation::NotApplied => (
                OperationResultStatus::Failed,
                None,
                Some("reconciliation_not_applied".into()),
            ),
            Reconciliation::Unknown => (
                OperationResultStatus::Unknown,
                None,
                Some("ambiguous_remote_result".into()),
            ),
        },
        Err(error) => (
            match error {
                WriteError::PermissionDenied
                | WriteError::Validation
                | WriteError::RemoteConflict => OperationResultStatus::Failed,
                WriteError::Unavailable | WriteError::Transport => OperationResultStatus::Unknown,
                WriteError::Timeout | WriteError::Ambiguous => unreachable!(),
            },
            None,
            Some(write_error_code(error).into()),
        ),
    };
    RedactedOperationResult {
        operation_id: operation.operation_id(),
        operation_type: operation.operation_type().into(),
        status,
        remote_reference,
        error,
    }
}

fn redact_remote_reference(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.:/".contains(character))
    {
        None
    } else {
        Some(value.to_owned())
    }
}

fn write_error_code(error: WriteError) -> &'static str {
    match error {
        WriteError::PermissionDenied => "permission_denied",
        WriteError::Validation => "validation_failed",
        WriteError::RemoteConflict => "remote_conflict",
        WriteError::Timeout => "timeout",
        WriteError::Ambiguous => "ambiguous_remote_result",
        WriteError::Unavailable => "capability_unavailable",
        WriteError::Transport => "transport_error",
    }
}

fn map_state_error(error: StateMachineError) -> SyncError {
    match error {
        StateMachineError::StaleRevision { expected, actual } => {
            SyncError::StaleRevision { expected, actual }
        }
        StateMachineError::StaleRemoteRevision { .. } => SyncError::StaleRemoteRevision,
        StateMachineError::InvalidTransition { .. } => SyncError::InvalidState,
    }
}

fn stable_hash(value: &str) -> u64 {
    value.bytes().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}
