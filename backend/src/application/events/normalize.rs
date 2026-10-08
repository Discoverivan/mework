use crate::domain::snapshots::diff::SnapshotChange;
use crate::domain::subscriptions::model::{IssueFacts, NormalizedEvent};

pub fn normalize_issue_event(
    event_id: &str,
    external_id: &str,
    issue: &IssueFacts,
    change: SnapshotChange,
) -> NormalizedEvent {
    NormalizedEvent {
        event_id: event_id.to_owned(),
        external_id: external_id.to_owned(),
        issue: issue.clone(),
        change,
    }
}
