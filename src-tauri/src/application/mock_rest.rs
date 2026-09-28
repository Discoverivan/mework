use std::net::SocketAddr;

use serde_json::{json, Value};
use wiremock::{matchers::any, Mock, MockServer, ResponseTemplate};

use crate::application::dev_overlay::{DevMockMode, MockIntegrationUrls};

pub struct MockIntegrationServer {
    _server: MockServer,
    urls: MockIntegrationUrls,
}

impl MockIntegrationServer {
    pub async fn start(mode: DevMockMode) -> Result<Self, String> {
        let server = MockServer::builder()
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
    if method == "GET"
        && path.starts_with(
            "/bitbucket/rest/api/1.0/projects/MOCK/repos/sample-repository/pull-requests/",
        )
    {
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

fn bitbucket_dashboard_pr(
    item: crate::application::developer::MyPullRequestDto,
    origin: &str,
) -> Value {
    json!({
        "id": item.pull_request_id.parse::<u64>().unwrap_or(1), "version": 1,
        "title": item.title, "state": "OPEN", "open": true, "closed": false,
        "draft": false, "createdDate": 1760000000000_i64,
        "updatedDate": item.updated_date.unwrap_or(1760000000000_i64),
        "fromRef": bitbucket_ref(&item.source_branch, &item.project_key, &item.repository_slug),
        "toRef": bitbucket_ref(&item.target_branch, &item.project_key, &item.repository_slug),
        "author": {"user": {"name":"example-engineer", "displayName":item.author_display_name, "active":true}, "role":"AUTHOR", "approved":false, "status":"UNAPPROVED"},
        "reviewers": [],
        "links": {"self":[{"href":format!("{origin}/bitbucket/projects/{}/{}/pull-requests/{}", item.project_key, item.repository_slug, item.pull_request_id)}]}
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
    value["participants"] = json!([]);
    value
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
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        let mut issues = snapshot
            .monitors
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .map(|issue| jira_issue_from_overlay(issue))
            .collect::<Vec<_>>();
        if issues.is_empty() {
            issues.push(jira_sample_issue());
        }
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
    if method == "GET"
        && path.starts_with("/jira/rest/agile/1.0/sprint/")
        && path.ends_with("/issue")
    {
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        let mut issues = snapshot
            .monitors
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .map(jira_issue_from_overlay)
            .collect::<Vec<_>>();
        if !issues.iter().any(|issue| issue["key"] == "MOCK-201") {
            issues.push(jira_sample_issue());
        }
        let total = issues.len();
        return json_response(
            200,
            json!({"startAt":0,"maxResults":total,"total":total,"issues":issues}),
        );
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
    if method == "GET" && path.starts_with("/jira/rest/api/3/issue/") {
        let issue_key = path.rsplit('/').next().unwrap_or_default();
        let snapshot = match mode.snapshot() {
            Ok(snapshot) => snapshot,
            Err(error) => return json_response(500, json!({"error":error})),
        };
        if let Some(issue) = snapshot
            .monitors
            .into_iter()
            .flat_map(|monitor| monitor.issues)
            .find(|issue| issue.key == issue_key)
        {
            return json_response(200, jira_issue_from_overlay(issue));
        }
        if issue_key == "MOCK-201" {
            return json_response(200, jira_sample_issue());
        }
        return json_response(404, json!({"error":"Issue not found"}));
    }
    if method == "GET"
        && (path == "/jira/rest/api/2/issue/createmeta"
            || path == "/jira/rest/api/3/issue/createmeta")
    {
        return json_response(
            200,
            json!({"projects":[{"id":"mock-project-id","key":"MOCK","issuetypes":[{"id":"mock-subtask","name":"Sub-task","subtask":true,"fields":{"summary":{"required":true,"schema":{"type":"string"}},"parent":{"required":true,"schema":{"type":"issuelink"}}}}]}]}),
        );
    }
    if method == "POST" && path == "/jira/rest/api/2/issue" {
        let summary = request
            .body_json::<Value>()
            .ok()
            .and_then(|body| {
                body.pointer("/fields/summary")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "MOCK DATA · Created synthetic task".to_owned());
        match mode.add_task(&summary) {
            Ok(snapshot) => {
                let issue = snapshot.monitors[0].issues.last();
                let key = issue
                    .map(|issue| issue.key.clone())
                    .unwrap_or_else(|| "MOCK-999".to_owned());
                return json_response(201, json!({"id":key,"key":key}));
            }
            Err(error) => return json_response(500, json!({"error":error})),
        }
    }
    if method == "POST" && path == "/jira/rest/api/3/issue" {
        return json_response(201, json!({"id":"mock-created-issue","key":"MOCK-999"}));
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

fn jira_sample_issue() -> Value {
    json!({"id":"mock-issue-201","key":"MOCK-201","fields":{"summary":"MOCK DATA · Prepare example handoff","status":{"name":"In Progress"},"priority":{"name":"Medium"},"assignee":{"accountId":"mock-user-a","displayName":"Example Engineer A","active":true},"issuetype":{"name":"Sub-task","subtask":true},"parent":{"id":"mock-issue-200","key":"MOCK-200","fields":{"summary":"MOCK DATA · Example parent"}},"subtasks":[],"updated":"2026-09-21T12:00:00.000Z","project":{"id":"mock-project-id","key":"MOCK","name":"Example project","projectTypeKey":"software"}}})
}

fn json_response(status: u16, body: Value) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_json(body)
}

#[cfg(test)]
mod tests {
    use super::MockIntegrationServer;
    use crate::{
        application::dev_overlay::DevMockMode,
        infrastructure::integrations::{
            bitbucket_dc::client::BitbucketDcClient,
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

        let jira = JiraClient::new(&server.urls().jira).expect("Jira client");
        let issues = jira
            .search_issues("project = MOCK", 20)
            .await
            .expect("Jira REST response");
        assert!(issues.issues.iter().any(|issue| issue.key == "MOCK-101"));
        mode.set_task_status("MOCK-101", "Done")
            .expect("update shared overlay issue");
        let planning = JiraPlanningClient::new(&server.urls().jira, JiraDeployment::Cloud)
            .expect("Jira planning client");
        assert_eq!(planning.list_projects(20).await.unwrap().values.len(), 1);
        let boards = planning.list_boards_for_project("MOCK", 20).await.unwrap();
        assert_eq!(boards.values.len(), 1);
        let sprints = planning.list_sprints("1", 20).await.unwrap();
        assert_eq!(sprints.values.len(), 2);
        let sprint_issues = planning.list_sprint_issues("1", 20).await.unwrap();
        assert_eq!(sprint_issues.values.len(), 4);
        assert_eq!(
            sprint_issues
                .values
                .iter()
                .find(|issue| issue.key == "MOCK-101")
                .unwrap()
                .fields["status"]["name"],
            "Done"
        );
        let detail = planning.get_issue("MOCK-101").await.unwrap();
        assert_eq!(detail.fields["status"]["name"], "Done");
        let search_issue = jira
            .search_issues("project = MOCK", 20)
            .await
            .unwrap()
            .issues
            .into_iter()
            .find(|issue| issue.key == "MOCK-101")
            .unwrap();
        let sprint_issue = sprint_issues
            .values
            .iter()
            .find(|issue| issue.key == "MOCK-101")
            .unwrap();
        assert_eq!(search_issue.fields["issuetype"], detail.fields["issuetype"]);
        assert_eq!(sprint_issue.fields["issuetype"], detail.fields["issuetype"]);
        assert_eq!(
            search_issue.fields.get("parent"),
            detail.fields.get("parent")
        );
        assert_eq!(
            sprint_issue.fields.get("parent"),
            detail.fields.get("parent")
        );

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
        assert_eq!(pull_requests.values.len(), 3);
        let diff = bitbucket
            .pull_request_diff("MOCK", "sample-repository", 41)
            .await
            .expect("synthetic pull request diff");
        assert!(diff.contains("synthetic fixture"));
    }
}
