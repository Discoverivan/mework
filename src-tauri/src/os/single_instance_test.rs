use std::path::Path;

use super::single_instance::{action_for_second_instance, SingleInstanceAction};

#[test]
fn second_instance_requests_focus_for_existing_window() {
    let action = action_for_second_instance(
        &["sample-repository".to_owned(), "--sync-now".to_owned()],
        Path::new("/tmp/sample-repository"),
    );

    assert_eq!(action, SingleInstanceAction::FocusMainWindow);
}
