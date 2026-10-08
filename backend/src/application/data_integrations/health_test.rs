use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use crate::domain::models::IntegrationKind;

use super::health::{HealthStatus, ReqwestHealthChecker};

#[tokio::test]
async fn jira_health_check_uses_bearer_auth_and_reports_working() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/2/myself"))
        .and(header("authorization", "Bearer jira-pat"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            r#"{"displayName":"Test User","name":"test-user-a"}"#,
            "application/json",
        ))
        .expect(1)
        .mount(&server)
        .await;

    let checker = ReqwestHealthChecker::new();
    let result = checker
        .check(
            IntegrationKind::Jira,
            &server.uri(),
            "",
            false,
            Some("jira-pat"),
        )
        .await;

    assert_eq!(result.status, HealthStatus::Working);
    assert_eq!(result.message, None);
    assert_eq!(result.account_display_name.as_deref(), Some("Test User"));
}

#[tokio::test]
async fn bitbucket_health_check_reports_authenticated_username_when_server_returns_it() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/repos"))
        .and(query_param("limit", "1"))
        .and(header("authorization", "Bearer bb-pat"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("X-AUSERNAME", "test.user")
                .set_body_string("{}"),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/users"))
        .and(query_param("filter", "test.user"))
        .and(query_param("limit", "25"))
        .and(header("authorization", "Bearer bb-pat"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "values": [{
                "name": "test.user",
                "slug": "test.user",
                "displayName": "Test User"
            }],
            "isLastPage": true
        })))
        .expect(1)
        .mount(&server)
        .await;

    let result = ReqwestHealthChecker::new()
        .check(
            IntegrationKind::Bitbucket,
            &server.uri(),
            "",
            false,
            Some("bb-pat"),
        )
        .await;

    assert_eq!(result.status, HealthStatus::Working);
    assert_eq!(result.account_display_name.as_deref(), Some("Test User"));
}

#[tokio::test]
async fn confluence_health_check_reports_the_current_user_display_name() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/user/current"))
        .and(header("authorization", "Bearer confluence-pat"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "type": "known",
            "username": "test.user",
            "displayName": "Test User"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let result = ReqwestHealthChecker::new()
        .check(
            IntegrationKind::Confluence,
            &server.uri(),
            "",
            false,
            Some("confluence-pat"),
        )
        .await;

    assert_eq!(result.status, HealthStatus::Working);
    assert_eq!(result.account_display_name.as_deref(), Some("Test User"));
}
