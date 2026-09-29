use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::client::ConfluenceClient;

#[tokio::test]
async fn searches_pages_with_bearer_auth_and_returns_safe_results() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/search"))
        .and(header("authorization", "Bearer synthetic-token"))
        .and(query_param(
            "cql",
            "space = \"DOCS\" AND type=page AND siteSearch ~ \"release notes\"",
        ))
        .and(query_param("expand", "content.space"))
        .and(query_param("limit", "20"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "results": [{
                "content": {
                    "id": "10001",
                    "type": "page",
                    "title": "Example release notes",
                    "space": { "name": "Example space" },
                    "_links": { "webui": "/pages/viewpage.action?pageId=10001" }
                },
                "excerpt": "An <span class=\"search-highlight\">@@@hl@@@example@@@endhl@@@</span> summary",
                "lastModified": "2026-09-20T12:00:00.000Z"
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = ConfluenceClient::new(server.uri(), "synthetic-token", false).unwrap();
    let results = client
        .search("release notes", Some("DOCS"), 20)
        .await
        .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].title, "Example release notes");
    assert_eq!(results[0].excerpt.as_deref(), Some("An example summary"));
    assert_eq!(results[0].space_name.as_deref(), Some("Example space"));
    assert!(results[0]
        .url
        .as_deref()
        .is_some_and(|url| url.ends_with("/pages/viewpage.action?pageId=10001")));
}

#[tokio::test]
async fn fetches_page_content_by_id_with_bounded_plain_text() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/content/10001"))
        .and(header("authorization", "Bearer synthetic-token"))
        .and(query_param("expand", "body.storage"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": "10001",
            "title": "Example specification",
            "_links": {"webui": "/pages/viewpage.action?pageId=10001"},
            "body": {"storage": {"value": "<p>Acceptance criteria</p><p>Example outcome</p>"}}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = ConfluenceClient::new(server.uri(), "synthetic-token", false).unwrap();
    let page = client.get_page("10001").await.unwrap();

    assert_eq!(page.title, "Example specification");
    assert_eq!(page.text, "Acceptance criteria Example outcome");
    assert!(page.url.ends_with("/pages/viewpage.action?pageId=10001"));
}

#[tokio::test]
async fn resolves_display_url_page_by_space_and_title() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/content"))
        .and(header("authorization", "Bearer synthetic-token"))
        .and(query_param("spaceKey", "DOCS"))
        .and(query_param("title", "Example release notes"))
        .and(query_param("expand", "body.storage"))
        .and(query_param("limit", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "results": [{
                "id": "10001",
                "title": "Example release notes",
                "_links": {"webui": "/display/DOCS/Example+release+notes"},
                "body": {"storage": {"value": "<p>Example changes</p>"}}
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = ConfluenceClient::new(server.uri(), "synthetic-token", false).unwrap();
    let page = client
        .get_page_by_title("DOCS", "Example release notes")
        .await
        .unwrap();

    assert_eq!(page.id, "10001");
    assert_eq!(page.title, "Example release notes");
    assert_eq!(page.text, "Example changes");
}

#[tokio::test]
async fn resolves_a_space_name_from_its_key() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/space/DEMO"))
        .and(header("authorization", "Bearer synthetic-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 20001,
            "key": "DEMO",
            "name": "Example team space"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = ConfluenceClient::new(server.uri(), "synthetic-token", false).unwrap();
    let space = client.get_space("DEMO").await.unwrap();

    assert_eq!(space.id, "20001");
    assert_eq!(space.key, "DEMO");
    assert_eq!(space.name, "Example team space");
}
