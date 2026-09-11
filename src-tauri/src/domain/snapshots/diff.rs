use serde_json::Value;

use super::canonicalize::canonicalize;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum SnapshotChange {
    StatusChanged,
    AssigneeChanged,
    PriorityChanged,
    CommentUpdated,
}

pub fn diff_snapshots(before: &Value, after: &Value) -> Vec<SnapshotChange> {
    let before = canonicalize(before);
    let after = canonicalize(after);
    let selected_fields = [
        ("status", SnapshotChange::StatusChanged),
        ("assignee", SnapshotChange::AssigneeChanged),
        ("priority", SnapshotChange::PriorityChanged),
        ("comment_updated_at", SnapshotChange::CommentUpdated),
    ];

    selected_fields
        .into_iter()
        .filter_map(|(field, change)| (before.get(field) != after.get(field)).then_some(change))
        .collect()
}
