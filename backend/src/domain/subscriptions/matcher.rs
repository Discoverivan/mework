use super::model::{InboxCandidate, NormalizedEvent, SubscriptionDefinition};

pub fn match_subscriptions(
    event: &NormalizedEvent,
    subscriptions: &[SubscriptionDefinition],
) -> Vec<InboxCandidate> {
    subscriptions
        .iter()
        .filter(|subscription| {
            subscription.rule.project == event.issue.project
                && subscription.rule.status == event.issue.status
                && subscription.rule.assignee_group == event.issue.assignee_group
        })
        .map(|subscription| InboxCandidate {
            event_id: event.event_id.clone(),
            subscription_id: subscription.id.clone(),
            title: event.issue.title.clone(),
            reason: format!("matched subscription {}", subscription.name),
        })
        .collect()
}
