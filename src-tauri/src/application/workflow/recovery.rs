use crate::domain::workflows::state_machine::WorkflowStatus;

#[derive(Debug, Clone, Default)]
pub struct RecoveryProgress {
    pub hermes_run_id: Option<String>,
    pub event_cursor: Option<String>,
}

pub fn recover_status(status: WorkflowStatus, progress: RecoveryProgress) -> WorkflowStatus {
    match status {
        WorkflowStatus::Running
            if progress.hermes_run_id.is_some() || progress.event_cursor.is_some() =>
        {
            WorkflowStatus::Unknown
        }
        WorkflowStatus::Running => WorkflowStatus::Queued,
        other => other,
    }
}
