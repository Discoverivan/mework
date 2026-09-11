use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::client::JiraClient;
const PAGE_ONE: &str = include_str!("../../../../../tests/fixtures/jira/search_page_1.json");
const PAGE_TWO: &str = include_str!("../../../../../tests/fixtures/jira/search_page_2.json");

#[tokio::test]
async fn fetches_all_jira_search_pages() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/2/search"))
        .and(query_param("startAt", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_string(PAGE_ONE))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/rest/api/2/search"))
        .and(query_param("startAt", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_string(PAGE_TWO))
        .expect(1)
        .mount(&server)
        .await;

    let client = JiraClient::new(server.uri()).expect("valid Jira base URL");
    let result = client
        .search_issues("project = DEMO", 2)
        .await
        .expect("search should succeed");

    assert_eq!(result.page_count, 2);
    assert_eq!(result.issues.len(), 3);
}
