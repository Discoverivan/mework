use wiremock::matchers::{body_json, header, method, path, query_param, query_param_is_missing};
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
async fn loads_open_authored_pull_requests_with_author_dashboard_role() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/dashboard/pull-requests"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("role", "AUTHOR"))
        .and(query_param("state", "OPEN"))
        .and(query_param("order", "NEWEST"))
        .and(query_param("limit", "100"))
        .and(query_param("start", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 2,
            "total": 2,
            "limit": 100,
            "isLastPage": true,
            "values": [{
                "id": 42,
                "version": 2,
                "title": "Owned change",
                "state": "OPEN",
                "draft": false,
                "open": true,
                "closed": false,
                "createdDate": 1760000000000_i64,
                "updatedDate": 1760001000000_i64,
                "fromRef": {"id": "refs/heads/feature/owned", "displayId": "feature/owned", "latestCommit": "owned123"},
                "toRef": {"id": "refs/heads/main", "displayId": "main", "latestCommit": "def456"},
                "author": {"user": {"name": "current-user", "displayName": "Current User", "active": true}, "role": "AUTHOR", "approved": false, "status": "UNAPPROVED"},
                "reviewers": [],
                "links": {"self": [{"href": "https://bitbucket.example/projects/DEMO/repos/sample-repository/pull-requests/42"}]}
            }, {
                "id": 43,
                "version": 1,
                "title": "Owned draft",
                "state": "OPEN",
                "draft": true,
                "open": true,
                "closed": false,
                "createdDate": 1760000000001_i64,
                "updatedDate": 1760001000001_i64,
                "fromRef": {"id": "refs/heads/feature/draft", "displayId": "feature/draft", "latestCommit": "draft123"},
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
    let page = client
        .list_authored_pull_requests_page(0, 100)
        .await
        .unwrap();

    assert_eq!(page.values.len(), 1);
    assert_eq!(page.values[0].id, 42);
    assert!(!page.values[0].draft);
}
#[tokio::test]
async fn retries_authored_dashboard_without_state_after_http_400() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/dashboard/pull-requests"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("role", "AUTHOR"))
        .and(query_param("state", "OPEN"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "errors": [{"message": "state is not supported for this role"}]
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/rest/api/1.0/dashboard/pull-requests"))
        .and(header("authorization", "Bearer test-token"))
        .and(query_param("role", "AUTHOR"))
        .and(query_param("order", "NEWEST"))
        .and(query_param("limit", "100"))
        .and(query_param("start", "0"))
        .and(query_param_is_missing("state"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "size": 2,
            "total": 2,
            "isLastPage": true,
            "values": [{
                "id": 42,
                "version": 2,
                "title": "Owned change",
                "state": "OPEN",
                "draft": false,
                "open": true,
                "closed": false,
                "fromRef": {"id": "refs/heads/feature/owned", "displayId": "feature/owned", "latestCommit": "owned123"},
                "toRef": {"id": "refs/heads/main", "displayId": "main", "latestCommit": "def456"},
                "author": null,
                "reviewers": [],
                "links": null
            }, {
                "id": 43,
                "version": 1,
                "title": "Declined change",
                "state": "DECLINED",
                "draft": false,
                "open": false,
                "closed": true,
                "fromRef": {"id": "refs/heads/declined", "displayId": "declined", "latestCommit": "declined123"},
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
    let page = client
        .list_authored_pull_requests_page(0, 100)
        .await
        .unwrap();

    assert_eq!(page.values.len(), 1);
    assert_eq!(page.values[0].id, 42);
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
async fn publishes_general_pull_request_comment() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(
            "/rest/api/1.0/projects/DEMO/repos/sample-repository/pull-requests/7/comments",
        ))
        .and(header("authorization", "Bearer test-token"))
        .and(body_json(serde_json::json!({
            "text": "AI review: handle this edge case"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "id": 11,
            "version": 0,
            "text": "AI review: handle this edge case"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let comment = client
        .publish_pull_request_comment(
            "DEMO",
            "sample-repository",
            7,
            "AI review: handle this edge case",
        )
        .await
        .unwrap();

    assert_eq!(comment.id, 11);
    assert_eq!(comment.text, "AI review: handle this edge case");
}

#[tokio::test]
async fn changes_pull_request_participant_status_to_approved() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/rest/api/1.0/projects/DEMO/repos/sample-repository/pull-requests/7/participants/current-user",
        ))
        .and(header("authorization", "Bearer test-token"))
        .and(body_json(serde_json::json!({
            "user": { "name": "current-user" },
            "approved": true,
            "status": "APPROVED"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "user": { "name": "current-user", "displayName": "Current User" },
            "role": "REVIEWER",
            "approved": true,
            "status": "APPROVED"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let participant = client
        .set_pull_request_participant_status(
            "DEMO",
            "sample-repository",
            7,
            "current-user",
            "APPROVED",
        )
        .await
        .unwrap();

    assert_eq!(participant.status.as_deref(), Some("APPROVED"));
    assert_eq!(participant.approved, Some(true));
}

#[tokio::test]
async fn changes_pull_request_participant_status_to_needs_work() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path(
            "/rest/api/1.0/projects/DEMO/repos/sample-repository/pull-requests/7/participants/current-user",
        ))
        .and(header("authorization", "Bearer test-token"))
        .and(body_json(serde_json::json!({
            "user": { "name": "current-user" },
            "approved": false,
            "status": "NEEDS_WORK"
        })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "user": { "name": "current-user", "displayName": "Current User" },
            "role": "REVIEWER",
            "approved": false,
            "status": "NEEDS_WORK"
        })))
        .expect(1)
        .mount(&server)
        .await;

    let client = BitbucketDcClient::with_bearer_token(server.uri(), "test-token").unwrap();
    let participant = client
        .set_pull_request_participant_status(
            "DEMO",
            "sample-repository",
            7,
            "current-user",
            "NEEDS_WORK",
        )
        .await
        .unwrap();

    assert_eq!(participant.status.as_deref(), Some("NEEDS_WORK"));
    assert_eq!(participant.approved, Some(false));
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
