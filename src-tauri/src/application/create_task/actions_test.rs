use super::*;
use crate::domain::models::{Integration, IntegrationHealthStatus};
use crate::infrastructure::db::open_database;
use wiremock::{
    matchers::{body_json, method, path},
    Mock, MockServer, ResponseTemplate,
};

fn integration(base_url: String) -> Integration {
    Integration {
        id: "example-integration".to_owned(),
        kind: IntegrationKind::Jira,
        base_url,
        account_key: String::new(),
        credential_ref: String::new(),
        enabled: true,
        allow_insecure_tls: false,
        account_display_name: None,
        health_status: IntegrationHealthStatus::Unknown,
        health_error: None,
        health_details: None,
        health_checked_at: None,
        capabilities_json: "{}".to_owned(),
        last_success_at: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

fn fields(summary: &str) -> serde_json::Map<String, Value> {
    task_fields(
        "EXAMPLE",
        JiraTaskIssueType::Task,
        summary.to_owned(),
        "Example description".to_owned(),
    )
}

fn replay_request(key: &str) -> JiraTaskCreateRequest {
    JiraTaskCreateRequest {
        operation_key: key.to_owned(),
        managed_project_id: "changed-team".to_owned(),
        issue_type: JiraTaskIssueType::Spike,
        summary: "Changed draft".to_owned(),
        description: "Changed description".to_owned(),
        epic_link: None,
        assignee: None,
        sprint: None,
        story_points: None,
    }
}

#[tokio::test]
async fn durable_creation_replays_after_restart_without_repeating_post_or_sprint() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/rest/api/2/issue"))
        // Exact body matching also checks that production fields omit priority.
        .and(body_json(json!({"fields": {
            "project": {"key": "EXAMPLE"}, "issuetype": {"name": "Task"},
            "summary": "Example task", "description": "Example description"
        }})))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(json!({"id": "101", "key": "EXAMPLE-1"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/rest/agile/1.0/sprint/7/issue"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&server)
        .await;
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("example.sqlite");
    let pool = open_database(&database).await.unwrap();
    let integration = integration(server.uri());
    let client = jira_http_client(&false).unwrap();
    // Empty credentials injected directly at the transport boundary; no OS keyring.
    let (first, concurrent) = tokio::join!(
        submit_task(
            &pool,
            "example-card",
            &integration,
            &client,
            "",
            fields("Example task"),
            Some("7")
        ),
        submit_task(
            &pool,
            "example-card",
            &integration,
            &client,
            "",
            fields("Example task"),
            Some("7")
        ),
    );
    let created = first.or(concurrent).unwrap();
    assert_eq!(created.key, "EXAMPLE-1");
    assert!(created.warning.is_some());
    let completed = actions::result(&pool, "example-card")
        .await
        .unwrap()
        .unwrap();
    pool.close().await;
    let pool = open_database(&database).await.unwrap();
    // Even changing the team/payload does not bypass a completed operation.
    let replayed = create_task(&pool, replay_request("example-card"))
        .await
        .unwrap();
    assert_eq!(replayed.key, created.key);
    assert_eq!(replayed.warning, completed.warning);
    server.verify().await;
}

#[tokio::test]
async fn uncertain_creation_stays_blocked_after_restart_and_draft_changes() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/rest/api/2/issue"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&server)
        .await;
    let temp = tempfile::tempdir().unwrap();
    let database = temp.path().join("example.sqlite");
    let pool = open_database(&database).await.unwrap();
    let integration = integration(server.uri());
    let client = jira_http_client(&false).unwrap();
    assert_eq!(
        submit_task(
            &pool,
            "example-card",
            &integration,
            &client,
            "",
            fields("Example task"),
            None
        )
        .await
        .unwrap_err(),
        actions::UNKNOWN
    );
    pool.close().await;
    let pool = open_database(&database).await.unwrap();
    assert_eq!(
        create_task(&pool, replay_request("example-card"))
            .await
            .unwrap_err(),
        actions::UNKNOWN
    );
    server.verify().await;
}

#[tokio::test]
async fn confirmed_rejection_allows_a_corrected_request() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/rest/api/2/issue"))
        .respond_with(ResponseTemplate::new(400))
        .expect(1)
        .mount(&server)
        .await;
    let temp = tempfile::tempdir().unwrap();
    let pool = open_database(&temp.path().join("example.sqlite"))
        .await
        .unwrap();
    let integration = integration(server.uri());
    let client = jira_http_client(&false).unwrap();
    assert!(submit_task(
        &pool,
        "example-card",
        &integration,
        &client,
        "",
        fields("Example task"),
        None
    )
    .await
    .is_err());
    server.verify().await;
    server.reset().await;
    Mock::given(method("POST"))
        .and(path("/rest/api/2/issue"))
        .respond_with(
            ResponseTemplate::new(201).set_body_json(json!({"id": "101", "key": "EXAMPLE-1"})),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        submit_task(
            &pool,
            "example-card",
            &integration,
            &client,
            "",
            fields("Corrected task"),
            None
        )
        .await
        .unwrap()
        .key,
        "EXAMPLE-1"
    );
    server.verify().await;
}
