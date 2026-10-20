use super::*;
use crate::infrastructure::db::open_database;
use wiremock::{
    matchers::{method, path, query_param},
    Mock, MockServer, ResponseTemplate,
};

async fn fixture() -> (
    tempfile::TempDir,
    SqlitePool,
    ManagedProject,
    JiraPlanningClient,
    MockServer,
) {
    let directory = tempfile::tempdir().unwrap();
    let pool = open_database(&directory.path().join("example.sqlite"))
        .await
        .unwrap();
    let server = MockServer::start().await;
    sqlx::query("INSERT INTO integrations (id,kind,base_url,account_key,credential_ref,created_at,updated_at) VALUES ('jira-1','jira',?,'','','now','now')")
        .bind(server.uri()).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO managed_projects (id,integration_id,jira_project_id,jira_project_key,jira_project_name,board_id,created_at,updated_at) VALUES ('team-1','jira-1','10001','DEMO','Example Team','42','now','now')")
        .execute(&pool).await.unwrap();
    let project = planning_repositories::get_managed_project(&pool, "team-1")
        .await
        .unwrap();
    let preset = TeamPreset {
        id: "preset-1".into(),
        integration_id: "jira-1".into(),
        jira_project_id: "10001".into(),
        name: "Project team".into(),
        display_color: None,
        selected: false,
        created_at: "now".into(),
        updated_at: "now".into(),
    };
    let members = ["user-a", "user-old"]
        .into_iter()
        .enumerate()
        .map(|(index, id)| TeamMember {
            id: format!("member-{index}"),
            preset_id: preset.id.clone(),
            account_id: id.into(),
            display_name: format!("Example Previous {index}"),
            alias: Some("Example Alias".into()),
            avatar_url: None,
            tags_json: "[\"backend\"]".into(),
            active: true,
            display_order: index as i64,
            created_at: "now".into(),
            updated_at: "now".into(),
        })
        .collect::<Vec<_>>();
    planning_repositories::upsert_team_preset(&pool, &preset, &members)
        .await
        .unwrap();
    let client = JiraPlanningClient::new_with_dependencies(
        server.uri(),
        JiraDeployment::DataCenter,
        Arc::new(ReqwestPlanningTransport::new(reqwest::Client::new())),
        None,
        None,
    )
    .unwrap();
    Mock::given(method("GET"))
        .and(path("/rest/agile/1.0/board/42/sprint"))
        .and(query_param("state", "active"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "startAt": 0, "maxResults": 100, "isLast": true,
            "values": [
                {"id": 101, "name": "Example Sprint A", "state": "active"},
                {"id": 102, "name": "Example Sprint B", "state": "active"}
            ]
        })))
        .expect(1)
        .mount(&server)
        .await;
    (directory, pool, project, client, server)
}

fn issue(id: &str, user: &str, name: &str) -> Value {
    json!({"id": id, "key": format!("DEMO-{id}"), "fields": {"assignee": {"name": user, "displayName": name, "active": true}}})
}

#[tokio::test]
async fn sync_team_members_replaces_roster_with_unique_assignees_from_all_pages_and_active_sprints()
{
    let (_directory, pool, project, client, server) = fixture().await;
    for (start, task) in [
        (0, issue("1", "user-a", "Example Member A")),
        (1, issue("2", "user-b", "Example Member B")),
    ] {
        Mock::given(method("GET"))
            .and(path("/rest/agile/1.0/board/42/sprint/101/issue"))
            .and(query_param("fields", "assignee"))
            .and(query_param("startAt", start.to_string()))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "startAt": start, "maxResults": 100, "total": 2, "issues": [task]
            })))
            .expect(1)
            .mount(&server)
            .await;
    }
    Mock::given(method("GET")).and(path("/rest/agile/1.0/board/42/sprint/102/issue"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "startAt": 0, "maxResults": 100, "total": 1, "issues": [issue("3", "user-a", "Example Member A")]
        }))).expect(1).mount(&server).await;
    let members = sync_team_members_with_client(&pool, &project, &client)
        .await
        .unwrap();
    assert_eq!(
        members
            .iter()
            .map(|member| member.account_id.as_str())
            .collect::<Vec<_>>(),
        ["user-a", "user-b"]
    );
    assert_eq!(members[0].alias.as_deref(), Some("Example Alias"));
    assert_eq!(members[0].tags, ["backend"]);
    assert_eq!(members[0].display_name, "Example Member A");
    assert!(members[1].alias.is_none() && members[1].tags.is_empty());
    let persisted = list_configured_team_members(&pool, &project.id)
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(persisted).unwrap(),
        serde_json::to_value(members).unwrap()
    );
    server.verify().await;
}

#[tokio::test]
async fn sync_team_members_preserves_entire_roster_when_a_later_sprint_load_fails() {
    let (_directory, pool, project, client, server) = fixture().await;
    let before = serde_json::to_value(
        list_configured_team_members(&pool, &project.id)
            .await
            .unwrap(),
    )
    .unwrap();
    Mock::given(method("GET")).and(path("/rest/agile/1.0/board/42/sprint/101/issue"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "startAt": 0, "maxResults": 100, "total": 1, "issues": [issue("1", "user-b", "Example Member B")]
        }))).expect(1).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/rest/agile/1.0/board/42/sprint/102/issue"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1..)
        .mount(&server)
        .await;
    assert!(sync_team_members_with_client(&pool, &project, &client)
        .await
        .is_err());
    let after = serde_json::to_value(
        list_configured_team_members(&pool, &project.id)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(after, before);
    server.verify().await;
}
