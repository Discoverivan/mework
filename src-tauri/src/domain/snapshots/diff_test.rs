use serde_json::json;

use super::diff::{diff_snapshots, SnapshotChange};

#[test]
fn emits_one_typed_event_for_each_selected_field_change() {
    let cases = [
        ("status", "Open", "Ready", SnapshotChange::StatusChanged),
        (
            "assignee",
            "analyst-a",
            "analyst-b",
            SnapshotChange::AssigneeChanged,
        ),
        ("priority", "P2", "P1", SnapshotChange::PriorityChanged),
        (
            "comment_updated_at",
            "2026-09-04T10:00:00Z",
            "2026-09-04T10:01:00Z",
            SnapshotChange::CommentUpdated,
        ),
    ];

    for (field, before_value, after_value, expected) in cases {
        let before = json!({field: before_value});
        let after = json!({field: after_value});
        assert_eq!(diff_snapshots(&before, &after), vec![expected]);
    }
}
