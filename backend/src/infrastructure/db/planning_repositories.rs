use sqlx::{Row, SqlitePool};

use crate::domain::planning::models::{
    AuditEvent, ManagedProject, ManagedProjectConfluenceSpace, PlanningItem, PlanningStatus,
    SubtaskPlan, SyncAction, SyncActionStatus, TeamMember, TeamPreset, Workspace,
};

pub async fn insert_managed_project(
    pool: &SqlitePool,
    value: &ManagedProject,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO managed_projects (id,integration_id,jira_project_id,jira_project_key,jira_project_name,board_id,source_sprint_id,source_sprint_name,story_points_field_id,competency_field_id,subtask_issue_type_id,default_team_preset_id,default_task_sprint_id,default_task_sprint_name,epic_link_jql,default_epic_link_key,default_epic_link_summary,enabled,last_metadata_refresh_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.integration_id).bind(&value.jira_project_id).bind(&value.jira_project_key).bind(&value.jira_project_name).bind(&value.board_id).bind(&value.source_sprint_id).bind(&value.source_sprint_name).bind(&value.story_points_field_id).bind(&value.competency_field_id).bind(&value.subtask_issue_type_id).bind(&value.default_team_preset_id).bind(&value.default_task_sprint_id).bind(&value.default_task_sprint_name).bind(&value.epic_link_jql).bind(&value.default_epic_link_key).bind(&value.default_epic_link_summary).bind(value.enabled).bind(&value.last_metadata_refresh_at).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn insert_managed_project_with_database_timestamps(
    pool: &SqlitePool,
    value: &ManagedProject,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO managed_projects (id,integration_id,jira_project_id,jira_project_key,jira_project_name,board_id,source_sprint_id,source_sprint_name,story_points_field_id,competency_field_id,subtask_issue_type_id,default_team_preset_id,default_task_sprint_id,default_task_sprint_name,epic_link_jql,default_epic_link_key,default_epic_link_summary,enabled,last_metadata_refresh_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(&value.id).bind(&value.integration_id).bind(&value.jira_project_id).bind(&value.jira_project_key).bind(&value.jira_project_name).bind(&value.board_id).bind(&value.source_sprint_id).bind(&value.source_sprint_name).bind(&value.story_points_field_id).bind(&value.competency_field_id).bind(&value.subtask_issue_type_id).bind(&value.default_team_preset_id).bind(&value.default_task_sprint_id).bind(&value.default_task_sprint_name).bind(&value.epic_link_jql).bind(&value.default_epic_link_key).bind(&value.default_epic_link_summary).bind(value.enabled).bind(&value.last_metadata_refresh_at).execute(pool).await.map(|_| ())
}

pub async fn list_managed_projects(
    pool: &SqlitePool,
    integration_id: Option<&str>,
) -> Result<Vec<ManagedProject>, sqlx::Error> {
    let rows = if let Some(integration_id) = integration_id {
        sqlx::query(
            "SELECT * FROM managed_projects WHERE integration_id = ? ORDER BY jira_project_key, id",
        )
        .bind(integration_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query("SELECT * FROM managed_projects ORDER BY jira_project_key, id")
            .fetch_all(pool)
            .await?
    };
    rows.into_iter().map(row_managed_project).collect()
}

pub async fn get_managed_project(
    pool: &SqlitePool,
    id: &str,
) -> Result<ManagedProject, sqlx::Error> {
    sqlx::query("SELECT * FROM managed_projects WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .and_then(row_managed_project)
}

pub async fn delete_managed_project(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM managed_projects WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected()
        == 1)
}

pub async fn primary_confluence_space(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Option<ManagedProjectConfluenceSpace>, sqlx::Error> {
    sqlx::query(
        "SELECT * FROM managed_project_confluence_spaces WHERE managed_project_id = ? AND is_primary = 1",
    )
    .bind(managed_project_id)
    .fetch_optional(pool)
    .await?
    .map(row_managed_project_confluence_space)
    .transpose()
}

pub async fn replace_primary_confluence_space(
    pool: &SqlitePool,
    value: Option<&ManagedProjectConfluenceSpace>,
    managed_project_id: &str,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query(
        "DELETE FROM managed_project_confluence_spaces WHERE managed_project_id = ? AND is_primary = 1",
    )
    .bind(managed_project_id)
    .execute(&mut *transaction)
    .await?;
    if let Some(value) = value {
        sqlx::query("INSERT INTO managed_project_confluence_spaces (id,managed_project_id,integration_id,space_id,space_key,space_name,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
            .bind(&value.id)
            .bind(&value.managed_project_id)
            .bind(&value.integration_id)
            .bind(&value.space_id)
            .bind(&value.space_key)
            .bind(&value.space_name)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await
}

pub async fn insert_workspace(pool: &SqlitePool, value: &Workspace) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_workspaces (id,managed_project_id,source_sprint_id,target_sprint_id,revision,status,remote_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.managed_project_id).bind(&value.source_sprint_id).bind(&value.target_sprint_id).bind(value.revision).bind(value.status.as_str()).bind(&value.remote_revision).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn load_workspace(pool: &SqlitePool, id: &str) -> Result<Workspace, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_workspaces WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .and_then(row_workspace)
}

pub async fn list_workspaces(
    pool: &SqlitePool,
    managed_project_id: &str,
) -> Result<Vec<Workspace>, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_workspaces WHERE managed_project_id = ? ORDER BY updated_at DESC, id").bind(managed_project_id).fetch_all(pool).await?.into_iter().map(row_workspace).collect()
}

pub async fn update_workspace_status(
    pool: &SqlitePool,
    id: &str,
    next: PlanningStatus,
) -> Result<Workspace, sqlx::Error> {
    let current = load_workspace(pool, id).await?;
    if !current.status.can_transition_to(next) {
        return Err(sqlx::Error::Protocol(format!(
            "invalid planning status transition: {} -> {}",
            current.status.as_str(),
            next.as_str()
        )));
    }
    sqlx::query("UPDATE planning_workspaces SET status = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(next.as_str()).bind(id).execute(pool).await?;
    load_workspace(pool, id).await
}

pub async fn insert_planning_item(
    pool: &SqlitePool,
    value: &PlanningItem,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_items (id,workspace_id,issue_id,issue_key,source_sprint_id,target_sprint_id,remote_updated_at,state,eligible,locked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.workspace_id).bind(&value.issue_id).bind(&value.issue_key).bind(&value.source_sprint_id).bind(&value.target_sprint_id).bind(&value.remote_updated_at).bind(&value.state).bind(value.eligible).bind(value.locked).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn insert_subtask_plan(
    pool: &SqlitePool,
    value: &SubtaskPlan,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_subtask_plans (id,planning_item_id,remote_subtask_id,competency_key,summary,story_points,assignee_account_id,local_revision,sync_status,locked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.planning_item_id).bind(&value.remote_subtask_id).bind(&value.competency_key).bind(&value.summary).bind(value.story_points).bind(&value.assignee_account_id).bind(value.local_revision).bind(&value.sync_status).bind(value.locked).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn insert_team_preset(pool: &SqlitePool, value: &TeamPreset) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_team_presets (id,integration_id,jira_project_id,name,display_color,selected,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.integration_id).bind(&value.jira_project_id).bind(&value.name).bind(&value.display_color).bind(value.selected).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn insert_team_member(pool: &SqlitePool, value: &TeamMember) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_team_members (id,preset_id,account_id,display_name,alias,avatar_url,tags_json,active,display_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.preset_id).bind(&value.account_id).bind(&value.display_name).bind(&value.alias).bind(&value.avatar_url).bind(&value.tags_json).bind(value.active).bind(value.display_order).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn update_managed_project_story_points_field_id(
    pool: &SqlitePool,
    id: &str,
    field_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE managed_projects SET story_points_field_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .bind(field_id)
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
}

pub async fn insert_sync_action(pool: &SqlitePool, value: &SyncAction) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_sync_actions (id,workspace_id,operation_type,idempotency_key,request_hash,status,remote_issue_id,remote_sprint_id,remote_subtask_id,retry_count,last_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.workspace_id).bind(&value.operation_type).bind(&value.idempotency_key).bind(&value.request_hash).bind(value.status.as_str()).bind(&value.remote_issue_id).bind(&value.remote_sprint_id).bind(&value.remote_subtask_id).bind(value.retry_count).bind(&value.last_error).bind(&value.created_at).bind(&value.updated_at).execute(pool).await.map(|_| ())
}

pub async fn insert_audit_event(pool: &SqlitePool, value: &AuditEvent) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO planning_audit_events (id,workspace_id,planning_item_id,action,previous_state,next_state,actor,remote_operation_id,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(&value.id).bind(&value.workspace_id).bind(&value.planning_item_id).bind(&value.action).bind(&value.previous_state).bind(&value.next_state).bind(&value.actor).bind(&value.remote_operation_id).bind(&value.occurred_at).execute(pool).await.map(|_| ())
}

pub async fn find_sync_action_by_idempotency(
    pool: &SqlitePool,
    idempotency_key: &str,
) -> Result<Option<SyncAction>, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_sync_actions WHERE idempotency_key = ?")
        .bind(idempotency_key)
        .fetch_optional(pool)
        .await?
        .map(row_sync_action)
        .transpose()
}

pub async fn mark_workspace_applying(
    pool: &SqlitePool,
    id: &str,
    expected_revision: i64,
) -> Result<Workspace, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE planning_workspaces
         SET status = 'applying', revision = revision + 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND revision = ? AND status = 'draft'",
    )
    .bind(id)
    .bind(expected_revision)
    .execute(pool)
    .await?;
    if result.rows_affected() != 1 {
        return Err(sqlx::Error::Protocol(
            "planning workspace revision conflict".into(),
        ));
    }
    load_workspace(pool, id).await
}

pub async fn find_workspace_by_selection(
    pool: &SqlitePool,
    managed_project_id: &str,
    source_sprint_id: Option<&str>,
    target_sprint_id: &str,
) -> Result<Option<Workspace>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT * FROM planning_workspaces WHERE managed_project_id = ?
         AND source_sprint_id IS ? AND target_sprint_id = ?
         ORDER BY updated_at DESC, id LIMIT 1",
    )
    .bind(managed_project_id)
    .bind(source_sprint_id)
    .bind(target_sprint_id)
    .fetch_optional(pool)
    .await?;
    row.map(row_workspace).transpose()
}

pub async fn get_planning_item(
    pool: &SqlitePool,
    workspace_id: &str,
    issue_id: &str,
) -> Result<Option<PlanningItem>, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_items WHERE workspace_id = ? AND issue_id = ?")
        .bind(workspace_id)
        .bind(issue_id)
        .fetch_optional(pool)
        .await?
        .map(row_planning_item)
        .transpose()
}

pub async fn list_planning_items(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<PlanningItem>, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_items WHERE workspace_id = ? ORDER BY id")
        .bind(workspace_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(row_planning_item)
        .collect()
}

pub async fn list_subtask_plans(
    pool: &SqlitePool,
    planning_item_id: &str,
) -> Result<Vec<SubtaskPlan>, sqlx::Error> {
    sqlx::query("SELECT * FROM planning_subtask_plans WHERE planning_item_id = ? ORDER BY id")
        .bind(planning_item_id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(row_subtask_plan)
        .collect()
}

pub async fn upsert_planning_item(
    pool: &SqlitePool,
    value: &PlanningItem,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO planning_items
         (id,workspace_id,issue_id,issue_key,source_sprint_id,target_sprint_id,remote_updated_at,state,eligible,locked,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id, issue_id) DO UPDATE SET
         source_sprint_id=excluded.source_sprint_id,target_sprint_id=excluded.target_sprint_id,
         state=excluded.state,eligible=excluded.eligible,updated_at=excluded.updated_at",
    )
    .bind(&value.id).bind(&value.workspace_id).bind(&value.issue_id).bind(&value.issue_key)
    .bind(&value.source_sprint_id).bind(&value.target_sprint_id).bind(&value.remote_updated_at)
    .bind(&value.state).bind(value.eligible).bind(value.locked).bind(&value.created_at).bind(&value.updated_at)
    .execute(pool).await.map(|_| ())
}

pub async fn replace_subtask_plans(
    pool: &SqlitePool,
    planning_item_id: &str,
    values: &[SubtaskPlan],
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM planning_subtask_plans WHERE planning_item_id = ?")
        .bind(planning_item_id)
        .execute(&mut *transaction)
        .await?;
    for value in values {
        sqlx::query("INSERT INTO planning_subtask_plans (id,planning_item_id,remote_subtask_id,competency_key,summary,story_points,assignee_account_id,local_revision,sync_status,locked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&value.id).bind(&value.planning_item_id).bind(&value.remote_subtask_id).bind(&value.competency_key).bind(&value.summary).bind(value.story_points).bind(&value.assignee_account_id).bind(value.local_revision).bind(&value.sync_status).bind(value.locked).bind(&value.created_at).bind(&value.updated_at)
            .execute(&mut *transaction).await?;
    }
    transaction.commit().await
}

pub async fn delete_planning_item(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM planning_items WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected()
        == 1)
}

pub async fn list_team_presets(
    pool: &SqlitePool,
    integration_id: &str,
    jira_project_id: &str,
) -> Result<Vec<(TeamPreset, Vec<TeamMember>)>, sqlx::Error> {
    let rows = sqlx::query("SELECT * FROM planning_team_presets WHERE integration_id = ? AND jira_project_id = ? ORDER BY name, id")
        .bind(integration_id).bind(jira_project_id).fetch_all(pool).await?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let preset = row_team_preset(row)?;
        let members = sqlx::query(
            "SELECT * FROM planning_team_members WHERE preset_id = ? ORDER BY display_order, account_id",
        )
        .bind(&preset.id)
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(row_team_member)
        .collect::<Result<Vec<_>, _>>()?;
        result.push((preset, members));
    }
    Ok(result)
}

pub async fn upsert_team_preset(
    pool: &SqlitePool,
    value: &TeamPreset,
    members: &[TeamMember],
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query("INSERT INTO planning_team_presets (id,integration_id,jira_project_id,name,display_color,selected,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,display_color=excluded.display_color,selected=excluded.selected,updated_at=excluded.updated_at")
        .bind(&value.id).bind(&value.integration_id).bind(&value.jira_project_id).bind(&value.name).bind(&value.display_color).bind(value.selected).bind(&value.created_at).bind(&value.updated_at).execute(&mut *transaction).await?;
    sqlx::query("DELETE FROM planning_team_members WHERE preset_id = ?")
        .bind(&value.id)
        .execute(&mut *transaction)
        .await?;
    for member in members {
        sqlx::query("INSERT INTO planning_team_members (id,preset_id,account_id,display_name,alias,avatar_url,tags_json,active,display_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
            .bind(&member.id).bind(&member.preset_id).bind(&member.account_id).bind(&member.display_name).bind(&member.alias).bind(&member.avatar_url).bind(&member.tags_json).bind(member.active).bind(member.display_order).bind(&member.created_at).bind(&member.updated_at).execute(&mut *transaction).await?;
    }
    transaction.commit().await
}

pub async fn reorder_team_members(
    pool: &SqlitePool,
    preset_id: &str,
    account_ids: &[String],
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    for (display_order, account_id) in account_ids.iter().enumerate() {
        let result = sqlx::query(
            "UPDATE planning_team_members
             SET display_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE preset_id = ? AND account_id = ?",
        )
        .bind(display_order as i64)
        .bind(preset_id)
        .bind(account_id)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            return Err(sqlx::Error::Protocol(
                "team member order contains an unknown member".into(),
            ));
        }
    }
    transaction.commit().await
}

pub async fn delete_team_preset(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM planning_team_presets WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected()
            == 1,
    )
}

fn row_managed_project(row: sqlx::sqlite::SqliteRow) -> Result<ManagedProject, sqlx::Error> {
    Ok(ManagedProject {
        id: row.try_get("id")?,
        integration_id: row.try_get("integration_id")?,
        jira_project_id: row.try_get("jira_project_id")?,
        jira_project_key: row.try_get("jira_project_key")?,
        jira_project_name: row.try_get("jira_project_name")?,
        board_id: row.try_get("board_id")?,
        source_sprint_id: row.try_get("source_sprint_id")?,
        source_sprint_name: row.try_get("source_sprint_name")?,
        story_points_field_id: row.try_get("story_points_field_id")?,
        competency_field_id: row.try_get("competency_field_id")?,
        subtask_issue_type_id: row.try_get("subtask_issue_type_id")?,
        default_team_preset_id: row.try_get("default_team_preset_id")?,
        default_task_sprint_id: row.try_get("default_task_sprint_id")?,
        default_task_sprint_name: row.try_get("default_task_sprint_name")?,
        default_epic_link_key: row.try_get("default_epic_link_key")?,
        default_epic_link_summary: row.try_get("default_epic_link_summary")?,
        epic_link_jql: row.try_get("epic_link_jql")?,
        enabled: row.try_get::<i64, _>("enabled")? != 0,
        last_metadata_refresh_at: row.try_get("last_metadata_refresh_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_managed_project_confluence_space(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ManagedProjectConfluenceSpace, sqlx::Error> {
    Ok(ManagedProjectConfluenceSpace {
        id: row.try_get("id")?,
        managed_project_id: row.try_get("managed_project_id")?,
        integration_id: row.try_get("integration_id")?,
        space_id: row.try_get("space_id")?,
        space_key: row.try_get("space_key")?,
        space_name: row.try_get("space_name")?,
        is_primary: row.try_get::<i64, _>("is_primary")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
fn row_workspace(row: sqlx::sqlite::SqliteRow) -> Result<Workspace, sqlx::Error> {
    Ok(Workspace {
        id: row.try_get("id")?,
        managed_project_id: row.try_get("managed_project_id")?,
        source_sprint_id: row.try_get("source_sprint_id")?,
        target_sprint_id: row.try_get("target_sprint_id")?,
        revision: row.try_get("revision")?,
        status: match row.try_get::<String, _>("status")?.as_str() {
            "draft" => PlanningStatus::Draft,
            "applying" => PlanningStatus::Applying,
            "partially_synced" => PlanningStatus::PartiallySynced,
            "locked" => PlanningStatus::Locked,
            "conflict" => PlanningStatus::Conflict,
            other => {
                return Err(sqlx::Error::Protocol(format!(
                    "unknown planning status: {other}"
                )))
            }
        },
        remote_revision: row.try_get("remote_revision")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_planning_item(row: sqlx::sqlite::SqliteRow) -> Result<PlanningItem, sqlx::Error> {
    Ok(PlanningItem {
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        issue_id: row.try_get("issue_id")?,
        issue_key: row.try_get("issue_key")?,
        source_sprint_id: row.try_get("source_sprint_id")?,
        target_sprint_id: row.try_get("target_sprint_id")?,
        remote_updated_at: row.try_get("remote_updated_at")?,
        state: row.try_get("state")?,
        eligible: row.try_get::<i64, _>("eligible")? != 0,
        locked: row.try_get::<i64, _>("locked")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_subtask_plan(row: sqlx::sqlite::SqliteRow) -> Result<SubtaskPlan, sqlx::Error> {
    Ok(SubtaskPlan {
        id: row.try_get("id")?,
        planning_item_id: row.try_get("planning_item_id")?,
        remote_subtask_id: row.try_get("remote_subtask_id")?,
        competency_key: row.try_get("competency_key")?,
        summary: row.try_get("summary")?,
        story_points: row.try_get("story_points")?,
        assignee_account_id: row.try_get("assignee_account_id")?,
        local_revision: row.try_get("local_revision")?,
        sync_status: row.try_get("sync_status")?,
        locked: row.try_get::<i64, _>("locked")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_team_preset(row: sqlx::sqlite::SqliteRow) -> Result<TeamPreset, sqlx::Error> {
    Ok(TeamPreset {
        id: row.try_get("id")?,
        integration_id: row.try_get("integration_id")?,
        jira_project_id: row.try_get("jira_project_id")?,
        name: row.try_get("name")?,
        display_color: row.try_get("display_color")?,
        selected: row.try_get::<i64, _>("selected")? != 0,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_team_member(row: sqlx::sqlite::SqliteRow) -> Result<TeamMember, sqlx::Error> {
    Ok(TeamMember {
        id: row.try_get("id")?,
        preset_id: row.try_get("preset_id")?,
        account_id: row.try_get("account_id")?,
        display_name: row.try_get("display_name")?,
        alias: row.try_get("alias")?,
        avatar_url: row.try_get("avatar_url")?,
        tags_json: row.try_get("tags_json")?,
        active: row.try_get::<i64, _>("active")? != 0,
        display_order: row.try_get("display_order")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn row_sync_action(row: sqlx::sqlite::SqliteRow) -> Result<SyncAction, sqlx::Error> {
    Ok(SyncAction {
        id: row.try_get("id")?,
        workspace_id: row.try_get("workspace_id")?,
        operation_type: row.try_get("operation_type")?,
        idempotency_key: row.try_get("idempotency_key")?,
        request_hash: row.try_get("request_hash")?,
        status: _status_from_db(row.try_get("status")?)?,
        remote_issue_id: row.try_get("remote_issue_id")?,
        remote_sprint_id: row.try_get("remote_sprint_id")?,
        remote_subtask_id: row.try_get("remote_subtask_id")?,
        retry_count: row.try_get("retry_count")?,
        last_error: row.try_get("last_error")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

#[allow(dead_code)]
fn _status_from_db(value: String) -> Result<SyncActionStatus, sqlx::Error> {
    match value.as_str() {
        "pending" => Ok(SyncActionStatus::Pending),
        "running" => Ok(SyncActionStatus::Running),
        "succeeded" => Ok(SyncActionStatus::Succeeded),
        "failed" => Ok(SyncActionStatus::Failed),
        "unknown" => Ok(SyncActionStatus::Unknown),
        _ => Err(sqlx::Error::Protocol("unknown sync action status".into())),
    }
}
