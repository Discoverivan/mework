use serde::{Deserialize, Serialize};

use crate::domain::snapshots::diff::SnapshotChange;

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct IssueFacts {
    pub project: String,
    pub status: String,
    pub assignee_group: String,
    pub title: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct SubscriptionRule {
    pub project: String,
    pub status: String,
    pub assignee_group: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct SubscriptionDefinition {
    pub id: String,
    pub name: String,
    pub rule: SubscriptionRule,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct NormalizedEvent {
    pub event_id: String,
    pub external_id: String,
    pub issue: IssueFacts,
    pub change: SnapshotChange,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct InboxCandidate {
    pub event_id: String,
    pub subscription_id: String,
    pub title: String,
    pub reason: String,
}
