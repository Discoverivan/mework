use super::state_machine::{transition, WorkflowEvent, WorkflowStatus};

#[test]
fn accepts_workflow_lifecycle_transitions() {
    let status = transition(WorkflowStatus::Queued, WorkflowEvent::Start).unwrap();
    assert_eq!(status, WorkflowStatus::Running);
    let status = transition(status, WorkflowEvent::RequestApproval).unwrap();
    assert_eq!(status, WorkflowStatus::WaitingApproval);
    let status = transition(status, WorkflowEvent::Approve).unwrap();
    assert_eq!(status, WorkflowStatus::Running);
    assert_eq!(
        transition(status, WorkflowEvent::Succeed).unwrap(),
        WorkflowStatus::Succeeded
    );
}
