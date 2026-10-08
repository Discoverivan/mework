use super::policy::{notification_plan, Importance, NotificationPlan};

#[test]
fn assigns_native_level_and_overlay_only_to_high_importance() {
    assert_eq!(
        notification_plan(Importance::Low, false),
        Some(NotificationPlan {
            importance: Importance::Low,
            overlay: false
        })
    );
    assert_eq!(
        notification_plan(Importance::Medium, false),
        Some(NotificationPlan {
            importance: Importance::Medium,
            overlay: false
        })
    );
    assert_eq!(
        notification_plan(Importance::High, false),
        Some(NotificationPlan {
            importance: Importance::High,
            overlay: true
        })
    );
}
