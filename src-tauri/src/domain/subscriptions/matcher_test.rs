use super::matcher::match_subscriptions;
use super::model::{IssueFacts, SubscriptionDefinition, SubscriptionRule};
use crate::application::events::normalize::normalize_issue_event;
use crate::domain::snapshots::diff::SnapshotChange;

#[test]
fn matching_rule_creates_one_inbox_candidate() {
    let issue = IssueFacts {
        project: "DEMO".into(),
        status: "Example status".into(),
        assignee_group: "Test Group".into(),
        title: "Example issue title".into(),
    };
    let event = normalize_issue_event("event-1", "DEMO-1", &issue, SnapshotChange::StatusChanged);
    let subscriptions = vec![SubscriptionDefinition {
        id: "subscription-1".into(),
        name: "Example subscription".into(),
        rule: SubscriptionRule {
            project: "DEMO".into(),
            status: "Example status".into(),
            assignee_group: "Test Group".into(),
        },
    }];

    let matches = match_subscriptions(&event, &subscriptions);

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].subscription_id, "subscription-1");
    assert_eq!(
        matches[0].reason,
        "matched subscription Example subscription"
    );
}
