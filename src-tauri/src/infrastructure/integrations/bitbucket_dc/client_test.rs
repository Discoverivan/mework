use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::client::BitbucketDcClient;
use super::models::BitbucketPullRequestAuthor;

#[tokio::test]
async fn loads_open_reviewer_pull_requests_with_display_name_author() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/dashboard/pull-requests"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("role", "REVIEWER"))
        .and(query_param("state", "OPEN"))
        .and(query_param("order", "NEWEST"))
        .and(query_param("limit", "100"))
        .and(query_param("start", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 1,
            "total": 101,
            "limit": 100,
            "isLastPage": true,
            "values": [{
                "id": 7,
                "version": 3,
                "title": "Example review change",
                "state": "OPEN",
                "draft": false,
                "open": true,
                "closed": false,
                "createdDate": 1760000000000_i64,
                "updatedDate": 1760001000000_i64,
                "fromRef": {"id": "refs/heads/feature/provider", "displayId": "feature/provider", "latestCommit": "abc123"},
                "toRef": {"id": "refs/heads/main", "displayId": "main", "latestCommit": "def456"},
                "author": {"user": {"name": "author", "displayName": "Author", "active": true}, "role": "AUTHOR", "approved": false, "status": "UNAPPROVED"},
                "reviewers": [{"user": {"name": "test-author-a", "displayName": "Test Author A", "active": true}, "role": "REVIEWER", "approved": true, "status": "APPROVED"}],
                "links": {"self": [{"href": "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/7"}]}
            }, {
                "id": 8,
                "version": 1,
                "title": "Draft pull request",
                "state": "OPEN",
                "draft": true,
                "open": true,
                "closed": false,
                "createdDate": 1760000000001_i64,
                "updatedDate": 1760001000001_i64,
                "fromRef": {"id": "refs/heads/draft", "displayId": "draft", "latestCommit": "draft123"},
                "toRef": {"id": "refs/heads/main", "displayId": "main", "latestCommit": "def456"},
                "author": null,
                "reviewers": [],
                "links": null
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let page = client.list_my_pull_requests_page(0, 100).await.unwrap();

    assert_eq!(page.values.len(), 1);
    assert!(!page.values[0].draft);
    assert_eq!(page.total, Some(101));
    assert_eq!(page.values[0].title, "Example review change");
    assert!(matches!(
        page.values[0].author,
        Some(BitbucketPullRequestAuthor::Participant(_))
    ));
}

#[tokio::test]
async fn loads_pull_request_diff_with_authentication() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(
            "/rest/api/1.0/projects/DEMO/repos/sample-repository/pull-requests/7.diff",
        ))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("diff --git a/src/lib.rs b/src/lib.rs\n+return true;\n"),
        )
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let diff = client
        .pull_request_diff("DEMO", "sample-repository", 7)
        .await
        .unwrap();

    assert!(diff.contains("src/lib.rs"));
    assert!(diff.contains("return true"));
}

#[tokio::test]
async fn reads_pull_request_details_for_commit_validation() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/projects/DEMO/repos/sample-repository/pull-requests/7"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "id": 7,
            "version": 3,
            "title": "Example review change",
            "description": "Description",
            "state": "OPEN",
            "open": true,
            "closed": false,
            "createdDate": 1760000000000_i64,
            "updatedDate": 1760001000000_i64,
            "fromRef": {"id": "refs/heads/feature/provider", "displayId": "feature/provider", "latestCommit": "abc123"},
            "toRef": {"id": "refs/heads/main", "displayId": "main", "latestCommit": "def456"},
            "locked": false,
            "author": null,
            "reviewers": [],
            "participants": [],
            "links": null
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let pull_request = client
        .get_pull_request("DEMO", "sample-repository", 7)
        .await
        .unwrap();

    assert_eq!(pull_request.id, 7);
    assert_eq!(
        pull_request.from_ref.latest_commit.as_deref(),
        Some("abc123")
    );
}

#[tokio::test]
async fn searches_bitbucket_repositories_by_name_and_project_name() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/repos"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("name", "COR"))
        .and(query_param("limit", "20"))
        .and(query_param("start", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 1,
            "limit": 20,
            "isLastPage": true,
            "values": [{
                "slug": "docs",
                "id": 7,
                "name": "Docs",
                "scmId": "git",
                "public": false,
                "project": {"key": "DEMO", "id": 3, "name": "Example Project", "public": false, "type": "NORMAL"}
            }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/repos"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("projectname", "COR"))
        .and(query_param("limit", "20"))
        .and(query_param("start", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 0,
            "limit": 20,
            "isLastPage": true,
            "values": []
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let page = client.search_repositories("COR", 20).await.unwrap();

    assert_eq!(page.values[0].project.key, "DEMO");
    assert_eq!(page.values[0].slug, "docs");
}

#[tokio::test]
async fn searches_bitbucket_users_by_display_name_filter() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/users"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("filter", "Муч"))
        .and(query_param("limit", "20"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 1,
            "limit": 20,
            "isLastPage": true,
            "values": [{"name": "test-user-b", "displayName": "Test User B", "slug": "test-user-b", "active": true}]
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let page = client.search_users("Муч", 20).await.unwrap();

    assert_eq!(page.values[0].display_name.as_deref(), Some("Test User B"));
}
