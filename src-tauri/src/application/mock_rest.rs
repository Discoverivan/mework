use std::net::{SocketAddr, TcpListener};

use serde_json::{json, Value};
use wiremock::{matchers::any, Mock, MockServer, ResponseTemplate};

use crate::application::dev_overlay::{MockIntegrationState as DevMockMode, MockIntegrationUrls};

pub struct MockIntegrationServer {
    _server: MockServer,
    urls: MockIntegrationUrls,
}

impl MockIntegrationServer {
    pub async fn start(mode: DevMockMode) -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "Could not bind the mock integrations listener".to_owned())?;
        Self::start_on(mode, listener).await
    }

    pub async fn start_on(mode: DevMockMode, listener: TcpListener) -> Result<Self, String> {
        let listener_address = listener
            .local_addr()
            .map_err(|_| "Could not read the mock integrations listener address".to_owned())?;
        if !listener_address.ip().is_loopback() {
            return Err("The mock integrations service may only bind to loopback".to_owned());
        }
        let server = MockServer::builder()
            .listener(listener)
            .disable_request_recording()
            .start()
            .await;
        let origin = server.uri();
        let shared_origin = origin.clone();
        Mock::given(any())
            .respond_with(move |request: &wiremock::Request| {
                respond(&mode, &shared_origin, request)
            })
            .mount(&server)
            .await;
        Ok(Self {
            _server: server,
            urls: MockIntegrationUrls {
                jira: format!("{origin}/jira/"),
                bitbucket: format!("{origin}/bitbucket/"),
                confluence: format!("{origin}/confluence/"),
            },
        })
    }

    pub fn urls(&self) -> &MockIntegrationUrls {
        &self.urls
    }

    pub fn address(&self) -> &SocketAddr {
        self._server.address()
    }
}

fn respond(mode: &DevMockMode, origin: &str, request: &wiremock::Request) -> ResponseTemplate {
    let method = request.method.as_str();
    let path = request.url.path();
    let url = request.url.as_str();
    if path == "/__mock/health" && method == "GET" {
        return json_response(200, json!({"status": "ready"}));
    }
    if path.starts_with("/__mock/") {
        return mock_control_response(mode, method, path, request);
    }
    if !mode.is_enabled() {
        return json_response(503, json!({"error": "Mock mode is disabled"}));
    }

    if path.starts_with("/bitbucket/") {
        return bitbucket_response(mode, origin, method, path, request);
    }
    if path.starts_with("/confluence/") {
        return confluence_response(origin, method, path, url);
    }
    if path.starts_with("/jira/") {
        return jira_response(mode, origin, method, path, url, request);
    }
    json_response(404, json!({"error": "Unknown mock integration route"}))
}

fn mock_control_response(
    mode: &DevMockMode,
    method: &str,
    path: &str,
    request: &wiremock::Request,
) -> ResponseTemplate {
    if !mode.is_enabled() {
        return json_response(503, json!({"error": "Mock mode is disabled"}));
    }
    let response: Result<Value, String> = match (method, path) {
        ("GET", "/__mock/state") => mode.snapshot().map(|value| json!(value)),
        ("POST", "/__mock/task") => parse_body::<SummaryRequest>(request)
            .and_then(|body| mode.add_task(&body.summary))
            .map(|value| json!(value)),
        ("POST", "/__mock/subtask") => parse_body::<SubtaskRequest>(request)
            .and_then(|body| {
                mode.create_jira_subtask(
                    &body.parent_issue_key,
                    &body.summary,
                    &body.assignee_id,
                    &body.sprint_id,
                )
                .and_then(|_| mode.snapshot())
            })
            .map(|value| json!(value)),
        ("POST", "/__mock/task/status") => parse_body::<StatusRequest>(request)
            .and_then(|body| mode.set_task_status(&body.issue_key, &body.status))
            .map(|value| json!(value)),
        ("POST", "/__mock/pull-request") => parse_body::<PullRequestRequest>(request)
            .and_then(|body| mode.add_pull_request(body.authored))
            .map(|value| json!(value)),
        ("POST", "/__mock/reset") => mode.reset().map(|value| json!(value)),
        _ => return json_response(404, json!({"error": "Unknown mock control route"})),
    };
    match response {
        Ok(value) => json_response(200, value),
        Err(error) => json_response(400, json!({"error": error})),
    }
}

#[derive(serde::Deserialize)]
struct SummaryRequest {
    summary: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubtaskRequest {
    parent_issue_key: String,
    summary: String,
    assignee_id: String,
    sprint_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusRequest {
    issue_key: String,
    status: String,
}

#[derive(serde::Deserialize)]
struct PullRequestRequest {
    authored: bool,
}

fn parse_body<T: serde::de::DeserializeOwned>(request: &wiremock::Request) -> Result<T, String> {
    serde_json::from_slice(&request.body).map_err(|_| "Invalid mock control request".to_owned())
}

fn bitbucket_response(
    mode: &DevMockMode,
    origin: &str,
    method: &str,
    path: &str,
    request: &wiremock::Request,
) -> ResponseTemplate {
    let page = |values: Vec<Value>| {
        json!({
            "size": values.len(), "limit": 100, "isLastPage": true,
            "start": 0, "values": values
        })
    };
    if method == "GET" && path == "/bitbucket/rest/api/1.0/repos" {
        let repo = json!({
            "slug": "sample-repository", "id": 1, "name": "Example repository",
            "scmId": "git", "state": "AVAILABLE", "public": false,
            "project": {"key":"MOCK", "id":1, "name":"Example project", "type":"NORMAL"}
        });
        return json_response(200, page(vec![repo]))
            .insert_header("x-ausername", "example-engineer");
    }
    if method == "GET" && path == "/bitbucket/rest/api/1.0/users" {
        return json_response(
            200,
            page(vec![json!({
                "name":"example-engineer", "displayName":"Example Engineer", "id":1, "active":true
            })]),
        );
    }
    if method == "GET" && path == "/bitbucket/rest/api/1.0/dashboard/pull-requests" {
        let authored = request
            .url
            .query_pairs()
            .any(|(key, value)| key == "role" && value == "AUTHOR");
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error": error})),
        };
        let items = if authored {
            snapshot.authored_pull_requests.values
        } else {
            snapshot.reviewer_pull_requests.values
        };
        let values = items
            .into_iter()
            .map(|item| bitbucket_dashboard_pr(item, origin))
            .collect();
        return json_response(200, page(values));
    }
    if method == "GET"
        && path == "/bitbucket/rest/api/1.0/projects/MOCK/repos/sample-repository/pull-requests"
    {
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error": error})),
        };
        let mut items = snapshot.reviewer_pull_requests.values;
        items.extend(snapshot.authored_pull_requests.values);
        let values = items
            .into_iter()
            .map(|item| bitbucket_pull_request(item, origin))
            .collect();
        return json_response(200, page(values));
    }
    let pr_prefix = "/bitbucket/rest/api/1.0/projects/MOCK/repos/sample-repository/pull-requests/";
    if method == "GET" && path.ends_with("/activities") && path.starts_with(pr_prefix) {
        let id = path
            .strip_prefix(pr_prefix)
            .and_then(|value| value.strip_suffix("/activities"))
            .unwrap_or_default();
        let comments = match mode.pull_request_comments(id) {
            Ok(comments) => comments,
            Err(error) => return json_response(404, json!({"error":error})),
        };
        let values = comments
            .iter()
            .filter(|comment| comment.parent_comment_id.is_none())
            .map(|comment| {
                json!({
                    "id":comment.id,
                    "action":"COMMENTED",
                    "commentAction":"ADDED",
                    "commentAnchor":comment.anchor,
                    "comment":bitbucket_comment_wire(comment, &comments)
                })
            })
            .collect();
        return json_response(200, page(values));
    }
    if method == "POST" && path.ends_with("/comments") && path.starts_with(pr_prefix) {
        let id = path
            .strip_prefix(pr_prefix)
            .and_then(|value| value.strip_suffix("/comments"))
            .unwrap_or_default();
        let body = match request.body_json::<Value>() {
            Ok(body) => body,
            Err(_) => return json_response(400, json!({"error":"Invalid comment request"})),
        };
        let Some(text) = body.get("text").and_then(Value::as_str) else {
            return json_response(400, json!({"error":"Comment text is required"}));
        };
        let comment = match mode.add_pull_request_comment(
            id,
            text,
            body.get("anchor").cloned(),
            body["parent"]["id"].as_u64(),
        ) {
            Ok(comment) => comment,
            Err(error) => return json_response(404, json!({"error":error})),
        };
        return json_response(
            201,
            json!({
                "id":comment.id,
                "version":comment.version,
                "text":comment.text,
                "createdDate":comment.created_date,
                "author":{"name":"example-engineer","displayName":"Example Engineer","active":true},
                "anchor":comment.anchor,
                "comments":[],
                "permitted":true
            }),
        );
    }
    if method == "PUT" && path.starts_with(pr_prefix) && path.contains("/participants/") {
        let mut segments = path.strip_prefix(pr_prefix).unwrap_or_default().split('/');
        let id = segments.next().unwrap_or_default();
        let participant = segments.next().unwrap_or_default();
        if participant != "participants" || segments.next() != Some("example-engineer") {
            return json_response(404, json!({"error":"Mock participant was not found"}));
        }
        let body = match request.body_json::<Value>() {
            Ok(body) => body,
            Err(_) => return json_response(400, json!({"error":"Invalid participant request"})),
        };
        let status = body
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if let Err(error) = mode.set_pull_request_decision(id, status) {
            return json_response(400, json!({"error":error}));
        }
        return json_response(
            200,
            json!({"user":{"name":"example-engineer","displayName":"Example Engineer","active":true},"role":"REVIEWER","approved":status == "APPROVED","status":status}),
        );
    }
    if method == "GET" && path.starts_with(pr_prefix) {
        if path.ends_with("/diff") {
            return json_response(
                200,
                json!({"diffs": std::iter::once("example.txt".to_owned()).chain(
                    path.strip_prefix(pr_prefix).and_then(|value| value.strip_suffix("/diff")).and_then(|id| id.parse::<u64>().ok())
                        .map(super::mock_reviews::findings).unwrap_or_default().into_iter().map(|fixture| fixture.finding.file)
                ).map(|file| json!({
                    "source": {"toString": file}, "destination": {"toString": file},
                    "hunks": [{"segments": [{"type": "ADDED", "lines": [{"source": 1, "destination": 1}]}]}]
                })).collect::<Vec<_>>()}),
            );
        }
        let suffix = path.rsplit('/').next().unwrap_or_default();
        if let Some(id) = suffix.strip_suffix(".diff") {
            let diff = format!(
                "diff --git a/example.txt b/example.txt\nindex 1111111..2222222 100644\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-example fixture\n+Updated synthetic fixture for PR {id}\n"
            );
            return ResponseTemplate::new(200).set_body_string(diff);
        }
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error": error})),
        };
        let mut items = snapshot.reviewer_pull_requests.values;
        items.extend(snapshot.authored_pull_requests.values);
        if let Some(item) = items
            .into_iter()
            .find(|item| item.pull_request_id == suffix)
        {
            return json_response(200, bitbucket_pull_request(item, origin));
        }
        return json_response(404, json!({"error": "Pull request not found"}));
    }
    if method == "POST" || method == "PUT" || method == "DELETE" {
        return ResponseTemplate::new(204);
    }
    json_response(404, json!({"error": "Unknown Bitbucket mock route"}))
}

fn bitbucket_comment_wire(
    comment: &super::dev_overlay::MockBitbucketComment,
    all: &[super::dev_overlay::MockBitbucketComment],
) -> Value {
    json!({
        "id": comment.id, "version": comment.version, "text": comment.text,
        "createdDate": comment.created_date, "anchor": comment.anchor,
        "author": {"name":"example-engineer", "displayName":"Example Engineer", "active":true},
        "comments": all.iter().filter(|reply| reply.parent_comment_id == Some(comment.id))
            .map(|reply| bitbucket_comment_wire(reply, all)).collect::<Vec<_>>(),
        "permitted": true
    })
}

fn bitbucket_dashboard_pr(
    item: crate::application::developer::MyPullRequestDto,
    origin: &str,
) -> Value {
    let mut from_ref = bitbucket_ref(
        &item.source_branch,
        &item.project_key,
        &item.repository_slug,
    );
    from_ref["latestCommit"] = json!(item.latest_commit);
    json!({
        "id": item.pull_request_id.parse::<u64>().unwrap_or(1), "version": 1,
        "title": item.title, "state": "OPEN", "open": true, "closed": false,
        "draft": false, "createdDate": 1760000000000_i64,
        "updatedDate": item.updated_date.unwrap_or(1760000000000_i64),
        "fromRef": from_ref,
        "toRef": bitbucket_ref(&item.target_branch, &item.project_key, &item.repository_slug),
        "author": {"user": {"name":"example-engineer", "displayName":item.author_display_name, "active":true}, "role":"AUTHOR", "approved":false, "status":"UNAPPROVED"},
        "reviewers": [bitbucket_reviewer(&item.my_decision)],
        "links": {"self":[{"href":format!("{origin}/bitbucket/projects/{}/repos/{}/pull-requests/{}", item.project_key, item.repository_slug, item.pull_request_id)}]}
    })
}

fn bitbucket_pull_request(
    item: crate::application::developer::MyPullRequestDto,
    origin: &str,
) -> Value {
    let mut value = bitbucket_dashboard_pr(item.clone(), origin);
    value["description"] = json!("Synthetic pull request fixture.");
    value["author"] =
        json!({"name":"example-engineer", "displayName":item.author_display_name, "active":true});
    value["participants"] = json!([bitbucket_reviewer(&item.my_decision)]);
    value["properties"] = json!({"reviewSummary":{"approved":item.review_summary.approved,"needsWork":item.review_summary.needs_work,"comments":item.review_summary.comments}});
    value
}

fn bitbucket_reviewer(decision: &str) -> Value {
    let status = match decision {
        "approved" => "APPROVED",
        "needs_work" => "NEEDS_WORK",
        _ => "UNAPPROVED",
    };
    json!({
        "user":{"name":"example-engineer","displayName":"Example Engineer","active":true},
        "role":"REVIEWER","approved":decision == "approved","status":status
    })
}

fn bitbucket_ref(branch: &str, project: &str, repository: &str) -> Value {
    json!({
        "id": format!("refs/heads/{branch}"), "displayId": branch, "latestCommit": "example-commit",
        "repository": {"slug":repository, "name":"Example repository", "project":{"key":project,"id":1,"name":"Example project"}}
    })
}

fn confluence_response(origin: &str, method: &str, path: &str, url: &str) -> ResponseTemplate {
    if method == "GET" && path == "/confluence/rest/api/user/current" {
        return json_response(
            200,
            json!({"displayName":"Example Engineer","username":"example-engineer"}),
        );
    }
    if method == "GET" && path == "/confluence/rest/api/search" {
        return json_response(
            200,
            json!({
                "results": [
                    {"content":{"id":"mock-page-1","type":"page","title":"MOCK DATA · Example runbook","space":{"id":1,"key":"MOCK","name":"Example space"},"_links":{"webui":"/spaces/MOCK/pages/mock-page-1"}},"title":"MOCK DATA · Example runbook","excerpt":"Synthetic page content for exercising search results.","url":"/spaces/MOCK/pages/mock-page-1","resultGlobalContainer":{"title":"Example space"},"lastModified":"2026-09-21T12:00:00Z"},
                    {"content":{"id":"mock-page-2","type":"page","title":"MOCK DATA · Example project notes","space":{"id":1,"key":"MOCK","name":"Example space"},"_links":{"webui":"/spaces/MOCK/pages/mock-page-2"}},"title":"MOCK DATA · Example project notes","excerpt":"Synthetic project notes used by the development scenario.","url":"/spaces/MOCK/pages/mock-page-2","resultGlobalContainer":{"title":"Example space"},"lastModified":"2026-09-21T12:00:00Z"}
                ], "start":0, "limit":25, "size":2
            }),
        );
    }
    if method == "GET" && path == "/confluence/rest/api/content" {
        let title = reqwest::Url::parse(url)
            .ok()
            .and_then(|url| {
                url.query_pairs()
                    .find(|(name, _)| name == "title")
                    .map(|(_, value)| value.into_owned())
            })
            .unwrap_or_else(|| "MOCK DATA · Example planning notes".to_owned());
        return json_response(
            200,
            json!({"results":[{
                "id":"10001", "title":title,
                "_links":{"webui":"/spaces/MOCK/pages/10001"},
                "body":{"storage":{"value":"<p>Synthetic acceptance criteria and implementation notes.</p>"}}
            }]}),
        );
    }
    if method == "GET" && path.starts_with("/confluence/rest/api/content/") {
        let id = path.rsplit('/').next().unwrap_or_default();
        return json_response(
            200,
            json!({
                "id": id,
                "title": "MOCK DATA · Example planning notes",
                "_links": {"webui": format!("/spaces/MOCK/pages/{id}")},
                "body": {"storage": {"value": "<p>Synthetic acceptance criteria and implementation notes.</p>"}}
            }),
        );
    }
    if method == "GET" && path.starts_with("/confluence/rest/api/space/") {
        let key = path.rsplit('/').next().unwrap_or("MOCK");
        return json_response(200, json!({"id":"1", "key":key, "name":"Example space"}));
    }
    let _ = (origin, url);
    json_response(404, json!({"error":"Unknown Confluence mock route"}))
}

fn jira_response(
    mode: &DevMockMode,
    origin: &str,
    method: &str,
    path: &str,
    url: &str,
    request: &wiremock::Request,
) -> ResponseTemplate {
    if method == "GET" && path == "/jira/rest/api/2/myself" {
        return json_response(
            200,
            json!({"displayName":"Example Engineer","name":"example-engineer"}),
        );
    }
    if method == "GET" && path == "/jira/rest/api/2/search" {
        let created = match mode.created_jira_issues() {
            Ok(created) => created,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        let created_keys = created
            .iter()
            .filter_map(|issue| issue["key"].as_str().map(str::to_owned))
            .collect::<Vec<_>>();
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        let mut issues = snapshot
            .monitors
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .filter(|issue| !created_keys.contains(&issue.key))
            .map(jira_issue_from_overlay)
            .collect::<Vec<_>>();
        issues.extend(created);
        if !issues.iter().any(|issue| issue["key"] == "MOCK-201") {
            issues.push(jira_sample_issue(mode));
        }
        let jql = request
            .url
            .query_pairs()
            .find(|(key, _)| key == "jql")
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default();
        issues.retain(|issue| jira_issue_matches_mock_jql(issue, &jql));
        return json_response(
            200,
            json!({"startAt":0,"maxResults":issues.len(),"total":issues.len(),"issues":issues}),
        );
    }
    if method == "GET" && path == "/jira/rest/api/2/project/MOCK" {
        return json_response(
            200,
            json!({"id":"mock-project-id","key":"MOCK","name":"Example project","projectTypeKey":"software"}),
        );
    }
    if method == "GET" && path == "/jira/rest/api/3/project/search" {
        return json_response(
            200,
            json!({"startAt":0,"maxResults":1,"total":1,"values":[{"id":"mock-project-id","key":"MOCK","name":"Example project","projectTypeKey":"software"}]}),
        );
    }
    if method == "GET" && path == "/jira/rest/greenhopper/1.0/quickfilters/mock-board-1" {
        return json_response(
            200,
            json!({"quickFilters":[
                {"id":1,"jql":"assignee = mock-user-a"},
                {"id":2,"jql":"assignee = mock-user-b"}
            ]}),
        );
    }
    if method == "GET"
        && path.starts_with("/jira/rest/agile/1.0/board/")
        && path.ends_with("/quickfilter")
    {
        return json_response(
            200,
            json!({"startAt":0,"maxResults":0,"total":0,"values":[]}),
        );
    }
    if method == "GET" && path == "/jira/rest/agile/1.0/board" {
        return json_response(
            200,
            json!({"startAt":0,"maxResults":1,"total":1,"values":[{"id":1,"name":"Example board","type":"scrum"}]}),
        );
    }
    if method == "GET"
        && path.starts_with("/jira/rest/agile/1.0/board/")
        && path.ends_with("/sprint")
    {
        return json_response(
            200,
            json!({"startAt":0,"maxResults":2,"total":2,"values":[{"id":1,"name":"Current sprint","state":"active","startDate":"2026-09-21T00:00:00.000Z","endDate":"2026-10-05T00:00:00.000Z"},{"id":2,"name":"Next sprint","state":"future","startDate":"2026-10-06T00:00:00.000Z","endDate":"2026-10-20T00:00:00.000Z"}]}),
        );
    }
    let sprint_issue_prefix = "/jira/rest/agile/1.0/sprint/";
    if path.starts_with(sprint_issue_prefix) && path.ends_with("/issue") {
        let sprint_id = path
            .strip_prefix(sprint_issue_prefix)
            .and_then(|value| value.strip_suffix("/issue"))
            .unwrap_or_default();
        if method == "POST" {
            let body = match request.body_json::<Value>() {
                Ok(body) => body,
                Err(_) => {
                    return json_response(400, json!({"error":"Invalid sprint assignment request"}))
                }
            };
            let keys = body
                .get("issues")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            return match mode.assign_jira_issues_to_sprint(sprint_id, &keys) {
                Ok(()) => ResponseTemplate::new(204),
                Err(error) => json_response(404, json!({"error":error})),
            };
        }
        if method == "GET" {
            let mut issues = if sprint_id == "1" {
                let created = match mode.created_jira_issues() {
                    Ok(created) => created,
                    Err(error) => return json_response(500, json!({"error":error})),
                };
                let created_keys = created
                    .iter()
                    .filter_map(|issue| issue["key"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>();
                let snapshot = match mode.snapshot() {
                    Ok(snapshot) => snapshot,
                    Err(error) => return json_response(500, json!({"error":error})),
                };
                let mut issues = snapshot
                    .monitors
                    .into_iter()
                    .flat_map(|monitor| monitor.issues)
                    .filter(|issue| !created_keys.contains(&issue.key))
                    .map(jira_issue_from_overlay)
                    .collect::<Vec<_>>();
                issues.push(jira_sample_issue(mode));
                issues
            } else {
                Vec::new()
            };
            match mode.created_jira_issues_for_sprint(sprint_id) {
                Ok(created) => issues.extend(created),
                Err(error) => return json_response(500, json!({"error":error})),
            }
            let total = issues.len();
            return json_response(
                200,
                json!({"startAt":0,"maxResults":total,"total":total,"issues":issues}),
            );
        }
    }
    let transitions_prefix = "/jira/rest/api/2/issue/";
    if path.starts_with(transitions_prefix) && path.ends_with("/transitions") {
        let issue_key = path
            .strip_prefix(transitions_prefix)
            .and_then(|value| value.strip_suffix("/transitions"))
            .unwrap_or_default();
        if method == "GET" {
            let status = match mode.daily_issue_status(issue_key) {
                Ok(status) => status,
                Err(error) => return json_response(404, json!({"error":error})),
            };
            return json_response(200, json!({"transitions":jira_daily_transitions(&status)}));
        }
        if method == "POST" {
            let body = match request.body_json::<Value>() {
                Ok(body) => body,
                Err(_) => return json_response(400, json!({"error":"Invalid transition request"})),
            };
            let transition_id = body
                .pointer("/transition/id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let status = match mode.daily_issue_status(issue_key) {
                Ok(status) => status,
                Err(error) => return json_response(404, json!({"error":error})),
            };
            let transition = jira_daily_transitions(&status)
                .into_iter()
                .find(|transition| {
                    transition.get("id").and_then(Value::as_str) == Some(transition_id)
                });
            let Some(transition) = transition else {
                return json_response(400, json!({"error":"Transition is no longer available"}));
            };
            if transition
                .pointer("/fields")
                .and_then(Value::as_object)
                .is_some_and(|fields| {
                    fields
                        .values()
                        .any(|field| field.get("required").and_then(Value::as_bool) == Some(true))
                })
            {
                return json_response(
                    400,
                    json!({"error":"Transition requires additional fields"}),
                );
            }
            let target_status = transition
                .pointer("/to/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Err(error) = mode.set_daily_issue_status(issue_key, target_status) {
                return json_response(400, json!({"error":error}));
            }
            return ResponseTemplate::new(204);
        }
    }
    if method == "GET" && path == "/jira/rest/api/2/field" {
        return json_response(
            200,
            json!([
                {"id":"mock-story-points","name":"Story Points","custom":true,"schema":{"type":"number"}},
                {"id":"mock-epic-link","name":"Epic Link","custom":true,"schema":{"type":"string"}}
            ]),
        );
    }
    if method == "GET" && path == "/jira/rest/api/2/user/assignable/search" {
        return json_response(
            200,
            json!([{"name":"mock-user-a","displayName":"Example Engineer A","active":true},{"name":"mock-user-b","displayName":"Example Engineer B","active":true}]),
        );
    }
    if method == "GET"
        && (path.starts_with("/jira/rest/api/3/issue/")
            || path.starts_with("/jira/rest/api/2/issue/"))
    {
        let is_changelog = path.ends_with("/changelog");
        let issue_path = path.strip_suffix("/changelog").unwrap_or(path);
        let issue_key = issue_path.rsplit('/').next().unwrap_or_default();
        if !is_changelog {
            match mode.created_jira_issue(issue_key) {
                Ok(Some(issue)) => return json_response(200, issue),
                Ok(None) => {}
                Err(error) => return json_response(500, json!({"error":error})),
            }
        }
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        let ram_task = snapshot
            .monitors
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .find(|issue| issue.key == issue_key);
        if is_changelog {
            let values = ram_task
                .as_ref()
                .and_then(|task| task.last_change.as_ref())
                .filter(|change| {
                    change.kind == crate::application::task_tracker::TaskTrackerChangeKind::Status
                })
                .and_then(|change| {
                    let from = change
                        .description
                        .strip_prefix("Status changed: ")?
                        .split_once(" → ")?
                        .0;
                    Some(json!([{
                        "id": change.detected_at,
                        "created": change.detected_at,
                        "items": [{"field":"status","fromString":from,"toString":ram_task.as_ref()?.status}]
                    }]))
                })
                .unwrap_or_else(|| json!([]));
            let total = values.as_array().map_or(0, Vec::len);
            return json_response(
                200,
                json!({"startAt":0,"maxResults":total,"total":total,"values":values}),
            );
        }
        let issue = ram_task.map(jira_issue_from_overlay).or_else(|| {
            let sample = jira_sample_issue(mode);
            if issue_key == "MOCK-201" {
                return Some(sample);
            }
            sample
                .pointer("/fields/parent")
                .filter(|parent| parent.get("key").and_then(Value::as_str) == Some(issue_key))
                .cloned()
        });
        return issue
            .map(|issue| json_response(200, issue))
            .unwrap_or_else(|| json_response(404, json!({"error":"Issue not found"})));
    }
    if method == "GET" && path == "/jira/rest/api/2/issue/createmeta" {
        return json_response(
            200,
            json!({"projects":[{"id":"mock-project-id","key":"MOCK","issuetypes":[{"id":"mock-subtask","name":"Sub-task","subtask":true,"fields":{"summary":{"required":true,"schema":{"type":"string"}},"parent":{"required":true,"schema":{"type":"issuelink"}}}}]}]}),
        );
    }
    if method == "POST" && path == "/jira/rest/api/2/issue" {
        let body = match request.body_json::<Value>() {
            Ok(body) => body,
            Err(_) => return json_response(400, json!({"error":"Invalid Jira issue request"})),
        };
        let fields = body.get("fields").unwrap_or(&Value::Null);
        return match mode.create_jira_issue(fields) {
            Ok((id, key)) => json_response(201, json!({"id":id,"key":key})),
            Err(error) => json_response(400, json!({"error":error})),
        };
    }
    if method == "POST" || method == "PUT" || method == "DELETE" {
        return ResponseTemplate::new(204);
    }
    let _ = (origin, url, request);
    json_response(404, json!({"error":"Unknown Jira mock route"}))
}

fn jira_issue_from_overlay(issue: crate::application::task_tracker::TaskTrackerIssueDto) -> Value {
    let assignee = issue.assignee.as_deref().unwrap_or("Example Engineer A");
    json!({
        "id": issue.key,
        "key": issue.key,
        "fields": {
            "summary": issue.summary,
            "status": {"name": issue.status},
            "priority": {"name": issue.priority},
            "assignee": {"accountId":"mock-user-a", "displayName":assignee, "active":true},
            "issuetype": {"name":"Task", "subtask":false},
            "updated": issue.updated,
            "project": {"id":"mock-project-id", "key":"MOCK", "name":"Example project", "projectTypeKey":"software"}
        }
    })
}

fn jira_issue_matches_mock_jql(issue: &Value, jql: &str) -> bool {
    let normalized = jql.to_ascii_lowercase();
    if normalized.contains("priority = high")
        && issue
            .pointer("/fields/priority/name")
            .and_then(Value::as_str)
            != Some("High")
    {
        return false;
    }
    if normalized.contains("project = mock")
        && issue.pointer("/fields/project/key").and_then(Value::as_str) != Some("MOCK")
    {
        return false;
    }
    true
}

fn jira_sample_issue(mode: &DevMockMode) -> Value {
    let status = mode
        .daily_issue_status("MOCK-201")
        .unwrap_or_else(|_| "In Progress".to_owned());
    json!({"id":"mock-issue-201","key":"MOCK-201","fields":{"summary":"MOCK DATA · Prepare example handoff","status":{"name":status},"priority":{"name":"Medium"},"assignee":{"accountId":"mock-user-a","displayName":"Example Engineer A","active":true},"issuetype":{"name":"Sub-task","subtask":true},"mock-story-points":3,"parent":{"id":"mock-issue-200","key":"MOCK-200","fields":{"summary":"MOCK DATA · Example parent"}},"subtasks":[],"updated":"2026-09-21T12:00:00.000Z","project":{"id":"mock-project-id","key":"MOCK","name":"Example project","projectTypeKey":"software"}}})
}

fn jira_daily_transitions(current_status: &str) -> Vec<Value> {
    let mut transitions = Vec::new();
    if current_status != "To Do" {
        transitions
            .push(json!({"id":"11","name":"Back to To Do","to":{"name":"To Do"},"fields":{}}));
    }
    if current_status != "In Progress" {
        transitions.push(
            json!({"id":"21","name":"Start Progress","to":{"name":"In Progress"},"fields":{}}),
        );
    }
    if current_status != "Done" {
        transitions.push(json!({"id":"31","name":"Resolve","to":{"name":"Done"},"fields":{}}));
        transitions.push(json!({"id":"32","name":"Resolve with resolution","to":{"name":"Done"},"fields":{"resolution":{"required":true}}}));
    }
    transitions
}

fn json_response(status: u16, body: Value) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_json(body)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::MockIntegrationServer;
    use crate::{
        application::dev_overlay::MockIntegrationState as DevMockMode,
        infrastructure::data_integrations::{
            bitbucket_dc::client::{BitbucketDcClient, BitbucketInlineComment},
            confluence::client::ConfluenceClient,
            jira::{client::JiraClient, models::JiraDeployment, planning::JiraPlanningClient},
        },
    };

    #[tokio::test]
    async fn ordinary_provider_clients_use_the_shared_loopback_rest_service() {
        let mode = DevMockMode::new(true);
        let server = MockIntegrationServer::start(mode.clone())
            .await
            .expect("start local REST stub");
        assert!(server.address().ip().is_loopback());
        let origin = server.urls().jira.strip_suffix("/jira/").unwrap();
        let health = reqwest::get(format!("{origin}/__mock/health"))
            .await
            .expect("mock simulator readiness endpoint");
        assert!(health.status().is_success());

        let jira = JiraClient::new(&server.urls().jira).expect("Jira client");
        let issues = jira
            .search_issues("project = MOCK", 20)
            .await
            .expect("Jira REST response");
        assert!(issues.issues.iter().any(|issue| issue.key == "MOCK-101"));
        assert!(issues.issues.iter().any(|issue| issue.key == "MOCK-201"));
        mode.set_task_status("MOCK-101", "Done")
            .expect("update shared overlay issue");
        let planning = JiraPlanningClient::new(&server.urls().jira, JiraDeployment::DataCenter)
            .expect("Jira planning client");
        let boards = planning.list_boards_for_project("MOCK", 20).await.unwrap();
        assert_eq!(boards.values.len(), 1);
        let sprints = planning.list_sprints("1", 20).await.unwrap();
        assert_eq!(sprints.values.len(), 2);
        let sprint_issues = planning.list_sprint_issues("1", 20).await.unwrap();
        assert_eq!(sprint_issues.values.len(), 6);
        assert_eq!(
            sprint_issues
                .values
                .iter()
                .find(|issue| issue.key == "MOCK-101")
                .unwrap()
                .fields["status"]["name"],
            "Done"
        );
        let summary_context = planning
            .get_issue_with_changelog("MOCK-101", Some("mock-story-points"))
            .await
            .expect("parent issue and status history");
        assert_eq!(summary_context["fields"]["status"]["name"], "Done");
        assert_eq!(
            summary_context.pointer("/changelog/histories/0/items/0/fromString"),
            Some(&serde_json::Value::String("In Progress".to_owned()))
        );
        assert_eq!(
            summary_context.pointer("/changelog/histories/0/items/0/toString"),
            Some(&serde_json::Value::String("Done".to_owned()))
        );
        let mock_parent = planning
            .get_issue_with_changelog("MOCK-200", Some("mock-story-points"))
            .await
            .expect("in-memory parent issue endpoint");
        assert_eq!(mock_parent["key"], "MOCK-200");
        assert_eq!(
            mock_parent["fields"]["summary"],
            "MOCK DATA · Example parent"
        );
        let high_priority = jira
            .search_issues("project = MOCK AND priority = High", 20)
            .await
            .expect("filter mock Jira results for Task Tracker JQL");
        assert_eq!(
            high_priority
                .issues
                .iter()
                .map(|issue| issue.key.as_str())
                .collect::<Vec<_>>(),
            vec!["MOCK-104", "MOCK-105"]
        );
        let data_center = JiraPlanningClient::new(&server.urls().jira, JiraDeployment::DataCenter)
            .expect("Jira Data Center planning client");
        let quick_filters = data_center
            .list_board_quick_filters("mock-board-1")
            .await
            .expect("mock assignee quick filters");
        assert_eq!(quick_filters.len(), 2);
        assert_eq!(quick_filters[0].jql, "assignee = mock-user-a");
        let transitions = data_center
            .available_issue_transitions("MOCK-201")
            .await
            .expect("mock Jira should provide issue workflow transitions");
        assert!(transitions
            .iter()
            .any(|transition| transition.to_status == "Done"));
        assert!(transitions
            .iter()
            .any(|transition| transition.requires_fields));
        data_center
            .transition_issue("MOCK-201", "31")
            .await
            .expect("mock Jira should accept an available transition");
        let sprint_issues = data_center
            .list_sprint_issues("1", 20)
            .await
            .expect("mock sprint issues should refresh after a transition");
        assert_eq!(sprint_issues.values.len(), 6);
        let updated_subtask = sprint_issues
            .values
            .iter()
            .find(|issue| issue.key == "MOCK-201")
            .expect("mock daily subtask should remain in the sprint");
        assert_eq!(updated_subtask.fields["status"]["name"], "Done");
        assert_eq!(updated_subtask.fields["mock-story-points"], 3);
        let refreshed_search_issue = jira
            .search_issues("project = MOCK AND key = MOCK-201", 20)
            .await
            .expect("Jira search after workflow change")
            .issues
            .into_iter()
            .find(|issue| issue.key == "MOCK-201")
            .expect("the updated task is searchable");
        assert_eq!(refreshed_search_issue.fields["status"]["name"], "Done");
        assert_eq!(refreshed_search_issue.fields["mock-story-points"], 3);
        let created = reqwest::Client::new()
            .post(format!(
                "{}/rest/api/2/issue",
                server.urls().jira.trim_end_matches('/')
            ))
            .json(&json!({"fields":{
                "summary":"MOCK DATA · Shared simulator write",
                "description":"Synthetic issue description",
                "issuetype":{"name":"Task"},
                "assignee":{"name":"mock-user-b"},
                "priority":{"name":"Medium"}
            }}))
            .send()
            .await
            .expect("create issue through Jira Data Center REST")
            .json::<Value>()
            .await
            .expect("Jira creation response");
        let created_key = created["key"].as_str().expect("created Jira key");
        reqwest::Client::new()
            .post(format!(
                "{}/rest/agile/1.0/sprint/2/issue",
                server.urls().jira.trim_end_matches('/')
            ))
            .json(&json!({"issues":[created_key]}))
            .send()
            .await
            .expect("assign new issue to the next sprint")
            .error_for_status()
            .expect("sprint assignment should succeed");
        let next_sprint = data_center
            .list_sprint_issues("2", 20)
            .await
            .expect("refresh next sprint after issue assignment");
        let created_issue = next_sprint
            .values
            .iter()
            .find(|issue| issue.key == created_key)
            .expect("created issue should appear in its assigned sprint");
        assert_eq!(created_issue.fields["assignee"]["accountId"], "mock-user-b");
        assert_eq!(
            created_issue.fields["assignee"]["displayName"],
            "Example Engineer B"
        );
        assert_eq!(created_issue.fields["issuetype"]["name"], "Task");
        let subtask_summary = "MOCK DATA · Overlay-created child task";
        reqwest::Client::new()
            .post(format!("{origin}/__mock/subtask"))
            .json(&json!({
                "parentIssueKey":created_key,
                "summary":subtask_summary,
                "assigneeId":"mock-user-b",
                "sprintId":"2"
            }))
            .send()
            .await
            .expect("create subtask through the MOCK DATA overlay control")
            .error_for_status()
            .expect("overlay subtask creation should succeed");
        let visible_subtasks = jira
            .search_issues("project = MOCK", 20)
            .await
            .expect("search Jira after subtask creation");
        let subtask_key = visible_subtasks
            .issues
            .iter()
            .find(|issue| issue.fields["summary"] == subtask_summary)
            .expect("created subtask should be searchable")
            .key
            .clone();
        let refreshed_next_sprint = data_center
            .list_sprint_issues("2", 20)
            .await
            .expect("created subtask should be visible after refresh");
        let created_subtask = refreshed_next_sprint
            .values
            .iter()
            .find(|issue| issue.key == subtask_key)
            .expect("created subtask should appear in its assigned sprint");
        assert_eq!(created_subtask.fields["issuetype"]["subtask"], true);
        assert_eq!(created_subtask.fields["parent"]["key"], created_key);
        assert_eq!(
            created_subtask.fields["assignee"]["accountId"],
            "mock-user-b"
        );
        data_center
            .transition_issue(&subtask_key, "21")
            .await
            .expect("created subtask should accept a workflow transition");
        let refreshed_next_sprint = data_center
            .list_sprint_issues("2", 20)
            .await
            .expect("created subtask status should be visible after refresh");
        assert_eq!(
            refreshed_next_sprint
                .values
                .iter()
                .find(|issue| issue.key == subtask_key)
                .unwrap()
                .fields["status"]["name"],
            "In Progress"
        );
        let current_sprint = data_center
            .list_sprint_issues("1", 20)
            .await
            .expect("current sprint should remain separate");
        assert!(!current_sprint
            .values
            .iter()
            .any(|issue| issue.key == created_key || issue.key == subtask_key));
        let visible = jira
            .search_issues("project = MOCK", 20)
            .await
            .expect("search Jira after issue creation");
        assert!(visible.issues.iter().any(|issue| issue.key == created_key));

        let confluence = ConfluenceClient::new(&server.urls().confluence, "synthetic-token", false)
            .expect("Confluence client");
        let pages = confluence
            .search("example", Some("MOCK"), 20)
            .await
            .expect("Confluence REST response");
        assert_eq!(pages.len(), 2);

        let bitbucket =
            BitbucketDcClient::with_bearer_token(&server.urls().bitbucket, "synthetic-token")
                .expect("Bitbucket client");
        let pull_requests = bitbucket
            .list_my_pull_requests_page(0, 20)
            .await
            .expect("Bitbucket REST response");
        assert_eq!(pull_requests.values.len(), 6);
        let diff = bitbucket
            .pull_request_diff("MOCK", "sample-repository", 41)
            .await
            .expect("synthetic pull request diff");
        assert!(diff.contains("synthetic fixture"));
        let participant = bitbucket
            .set_pull_request_participant_status(
                "MOCK",
                "sample-repository",
                41,
                "example-engineer",
                "APPROVED",
            )
            .await
            .expect("Bitbucket mock should persist a review decision");
        assert_eq!(participant.status.as_deref(), Some("APPROVED"));
        let comment = bitbucket
            .publish_pull_request_comment(
                "MOCK",
                "sample-repository",
                41,
                BitbucketInlineComment {
                    text: "Synthetic review comment",
                    path: "example.txt",
                    line: Some(1),
                },
            )
            .await
            .expect("Bitbucket mock should persist a review comment");
        assert_eq!(comment.text, "Synthetic review comment");
        let comments = bitbucket
            .list_pull_request_comments("MOCK", "sample-repository", 41, 20)
            .await
            .expect("read Bitbucket comments after write");
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].text, "Synthetic review comment");
        let refreshed = bitbucket
            .get_pull_request("MOCK", "sample-repository", 41)
            .await
            .expect("read Bitbucket pull request after writes");
        assert_eq!(
            refreshed.participants[0].status.as_deref(),
            Some("APPROVED")
        );
        assert_eq!(
            refreshed.properties.unwrap()["reviewSummary"]["comments"],
            1
        );
    }
}
