#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Importance {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct NotificationPlan {
    pub importance: Importance,
    pub overlay: bool,
}

pub fn notification_plan(importance: Importance, quiet_hours: bool) -> Option<NotificationPlan> {
    if quiet_hours {
        return None;
    }

    Some(NotificationPlan {
        importance,
        overlay: importance == Importance::High,
    })
}
