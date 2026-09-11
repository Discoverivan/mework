use serde_json::json;

use super::canonicalize::canonicalize;

#[test]
fn ignores_volatile_updated_at_field() {
    let before = json!({"status": "Ready", "updated_at": "2026-09-04T10:00:00Z"});
    let after = json!({"status": "Ready", "updated_at": "2026-09-04T10:01:00Z"});

    assert_eq!(canonicalize(&before), canonicalize(&after));
}
