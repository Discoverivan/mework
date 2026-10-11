use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPeriod {
    pub start_at: String,
    pub end_exclusive: String,
    pub time_zone: String,
}

impl SummaryPeriod {
    pub fn bounds(&self) -> Result<(OffsetDateTime, OffsetDateTime), String> {
        let invalid = || "A valid reporting date range and time zone are required".to_owned();
        let start = OffsetDateTime::parse(&self.start_at, &Rfc3339).map_err(|_| invalid())?;
        let end = OffsetDateTime::parse(&self.end_exclusive, &Rfc3339).map_err(|_| invalid())?;
        if start >= end || self.time_zone.trim().is_empty() || self.time_zone.len() > 100 {
            return Err(invalid());
        }
        Ok((start, end))
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportMembership {
    pub started_during_period: bool,
    pub completed_during_period: bool,
    pub still_in_progress: bool,
    pub not_started_yet: bool,
    pub classification_incomplete: bool,
}

fn known_category(category: Option<&str>) -> Option<&str> {
    category.filter(|key| matches!(*key, "new" | "indeterminate" | "done"))
}

pub fn report_membership(
    fields: &Value,
    transitions: &[Value],
    status_categories: &HashMap<String, String>,
    period: Option<(OffsetDateTime, OffsetDateTime)>,
) -> ReportMembership {
    let current = known_category(
        fields
            .pointer("/status/statusCategory/key")
            .and_then(Value::as_str)
            .or_else(|| {
                let id = fields.pointer("/status/id")?.as_str()?;
                status_categories.get(id).map(String::as_str)
            }),
    );
    let mut membership = ReportMembership {
        still_in_progress: current == Some("indeterminate"),
        not_started_yet: current == Some("new"),
        classification_incomplete: current.is_none(),
        ..Default::default()
    };
    let Some((start, end)) = period else {
        return membership;
    };
    for transition in transitions {
        let Some(at) = transition["at"]
            .as_str()
            .and_then(super::daily::parse_jira_timestamp)
        else {
            membership.classification_incomplete = true;
            continue;
        };
        if at < start || at >= end {
            continue;
        }
        let category = |field: &str| {
            known_category(
                transition[field]
                    .as_str()
                    .and_then(|id| status_categories.get(id))
                    .map(String::as_str),
            )
        };
        match (category("fromId"), category("toId")) {
            (Some(from), Some(to)) => {
                membership.started_during_period |= from == "new" && to == "indeterminate";
                membership.completed_during_period |= from != "done" && to == "done";
            }
            _ => membership.classification_incomplete = true,
        }
    }
    membership
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn classifies_report_events_by_status_ids_and_the_selected_local_days() {
        use crate::infrastructure::data_integrations::jira::{
            models::JiraDeployment, planning::JiraPlanningClient,
        };
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/2/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": "10", "statusCategory": {"key": "new"}},
                {"id": "20", "statusCategory": {"key": "indeterminate"}},
                {"id": "30", "statusCategory": {"key": "done"}}
            ])))
            .expect(1)
            .mount(&server)
            .await;
        let categories = JiraPlanningClient::new(server.uri(), JiraDeployment::DataCenter)
            .unwrap()
            .list_workflow_statuses()
            .await
            .unwrap()
            .into_iter()
            .filter_map(|status| {
                status
                    .status_category
                    .map(|category| (status.id, category.key))
            })
            .collect();
        let period: SummaryPeriod = serde_json::from_value(json!({
            "startAt": "2026-09-28T00:00:00+03:00",
            "endExclusive": "2026-10-01T00:00:00+03:00",
            "timeZone": "Europe/Moscow"
        }))
        .unwrap();
        let histories = vec![
            json!({"created": "2026-09-27T22:00:00.000+0000", "items": [{"field": "status", "from": "10", "to": "20", "fromString": "Queued", "toString": "Building"}]}),
            json!({"created": "2026-09-30T20:30:00.000+0000", "items": [{"field": "status", "from": "20", "to": "30", "fromString": "Building", "toString": "Released"}]}),
        ];
        let transitions = super::super::daily::status_transitions(Some(&histories));
        let membership = report_membership(
            &json!({"status": {"id": "30", "statusCategory": {"key": "done"}}}),
            &transitions,
            &categories,
            Some(period.bounds().unwrap()),
        );
        assert_eq!(
            serde_json::to_value(membership).unwrap(),
            json!({"startedDuringPeriod": true, "completedDuringPeriod": true,
                "stillInProgress": false, "notStartedYet": false, "classificationIncomplete": false})
        );
    }
}
