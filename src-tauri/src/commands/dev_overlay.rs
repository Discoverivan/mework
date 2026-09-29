use serde::{de::DeserializeOwned, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::application::dev_overlay::{self, DevMockMode, DevOverlaySnapshot};

#[tauri::command]
pub fn dev_overlay_enabled(mode: State<'_, DevMockMode>) -> bool {
    mode.is_enabled()
}

#[tauri::command]
pub async fn dev_overlay_state(mode: State<'_, DevMockMode>) -> Result<DevOverlaySnapshot, String> {
    if !mode.is_enabled() {
        return Err("Development mock mode is not enabled".to_owned());
    }
    control_call::<DevOverlaySnapshot, ()>("GET", "state", None).await
}

#[tauri::command]
pub async fn dev_overlay_add_task<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    summary: String,
) -> Result<DevOverlaySnapshot, String> {
    require_mock(&mode)?;
    let snapshot = control_call("POST", "task", Some(&SummaryRequest { summary })).await?;
    refresh_task_tracker(&app, &state).await?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn dev_overlay_add_subtask<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    parent_issue_key: String,
    summary: String,
    assignee_id: String,
    sprint_id: String,
) -> Result<DevOverlaySnapshot, String> {
    require_mock(&mode)?;
    let snapshot = control_call(
        "POST",
        "subtask",
        Some(&SubtaskRequest {
            parent_issue_key,
            summary,
            assignee_id,
            sprint_id,
        }),
    )
    .await?;
    refresh_task_tracker(&app, &state).await?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn dev_overlay_set_task_status<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    issue_key: String,
    status: String,
) -> Result<DevOverlaySnapshot, String> {
    require_mock(&mode)?;
    let snapshot = control_call(
        "POST",
        "task/status",
        Some(&StatusRequest { issue_key, status }),
    )
    .await?;
    refresh_task_tracker(&app, &state).await?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn dev_overlay_add_pull_request<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
    authored: bool,
) -> Result<crate::application::developer::MyPullRequestsPageDto, String> {
    require_mock(&mode)?;
    let _: crate::application::developer::MyPullRequestsPageDto = control_call(
        "POST",
        "pull-request",
        Some(&PullRequestRequest { authored }),
    )
    .await?;
    let page = if authored {
        crate::application::authored_pull_requests::list_authored_pull_requests_page(&state, 0, 100)
            .await
            .map_err(|error| error.message)?
    } else {
        crate::application::developer::list_my_pull_requests_page(&state, 0, 100)
            .await
            .map_err(|error| error.message)?
    };
    if authored {
        let _ = app.emit("my_pull_requests_updated", &page);
    } else {
        let _ = app.emit("pull_request_review_updated", &page);
    }
    Ok(page)
}

#[tauri::command]
pub async fn dev_overlay_reset_scenario<R: Runtime>(
    app: AppHandle<R>,
    mode: State<'_, DevMockMode>,
    state: State<'_, SqlitePool>,
) -> Result<DevOverlaySnapshot, String> {
    require_mock(&mode)?;
    let mut snapshot = control_call::<DevOverlaySnapshot, ()>("POST", "reset", None).await?;
    snapshot.monitors = refresh_task_tracker(&app, &state).await?;
    snapshot.reviewer_pull_requests =
        crate::application::developer::list_my_pull_requests_page(&state, 0, 100)
            .await
            .map_err(|error| error.message)?;
    snapshot.authored_pull_requests =
        crate::application::authored_pull_requests::list_authored_pull_requests_page(
            &state, 0, 100,
        )
        .await
        .map_err(|error| error.message)?;
    let _ = app.emit(
        "pull_request_review_updated",
        &snapshot.reviewer_pull_requests,
    );
    let _ = app.emit("my_pull_requests_updated", &snapshot.authored_pull_requests);
    Ok(snapshot)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryRequest {
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtaskRequest {
    parent_issue_key: String,
    summary: String,
    assignee_id: String,
    sprint_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusRequest {
    issue_key: String,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestRequest {
    authored: bool,
}

fn require_mock(mode: &DevMockMode) -> Result<(), String> {
    mode.require_enabled()
}

async fn control_call<T: DeserializeOwned, B: Serialize>(
    method: &str,
    path: &str,
    body: Option<&B>,
) -> Result<T, String> {
    let urls = dev_overlay::mock_integration_urls_from_env()?;
    let origin = urls
        .jira
        .strip_suffix("/jira/")
        .ok_or_else(|| "Mock integrations URL is invalid".to_owned())?;
    let url = format!("{origin}/__mock/{path}");
    let client = reqwest::Client::new();
    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        _ => return Err("Mock control operation is not supported".to_owned()),
    };
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Mock integrations service is unavailable".to_owned())?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Mock integrations service returned an unreadable response".to_owned())?;
    if !status.is_success() {
        let message = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|value| value.get("error")?.as_str().map(ToOwned::to_owned))
            .unwrap_or_else(|| format!("Mock integrations request failed ({status})"));
        return Err(message);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "Mock integrations service returned an invalid response".to_owned())
}

async fn refresh_task_tracker<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
) -> Result<Vec<crate::application::task_tracker::TaskTrackerMonitorDto>, String> {
    let monitors = crate::application::task_tracker::list_monitors(pool).await?;
    for monitor in monitors {
        crate::application::task_tracker::check_now(pool, app, &monitor.id).await?;
    }
    crate::application::task_tracker::list_monitors(pool).await
}
