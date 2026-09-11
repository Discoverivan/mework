use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Queued,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum WorkflowEvent {
    Start,
    RequestApproval,
    Approve,
    Reject,
    Succeed,
    Fail,
    Cancel,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct InvalidTransition;

pub fn transition(
    status: WorkflowStatus,
    event: WorkflowEvent,
) -> Result<WorkflowStatus, InvalidTransition> {
    use WorkflowEvent::*;
    use WorkflowStatus::*;

    match (status, event) {
        (Queued, Start) => Ok(Running),
        (Running, RequestApproval) => Ok(WaitingApproval),
        (WaitingApproval, Approve) => Ok(Running),
        (WaitingApproval, Reject) => Ok(Cancelled),
        (Queued | Running | WaitingApproval, Cancel) => Ok(Cancelled),
        (Running, Succeed) => Ok(Succeeded),
        (Running | WaitingApproval, Fail) => Ok(Failed),
        _ => Err(InvalidTransition),
    }
}
