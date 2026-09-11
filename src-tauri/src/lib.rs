use std::time::Duration;

use tauri::{Emitter, Manager};

pub mod application;
pub mod commands;
pub mod domain;
pub mod events;
pub mod infrastructure;
pub mod os;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            crate::os::single_instance::handle_second_instance(app, args, cwd);
        }));
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(crate::os::autostart::arguments()),
        ));
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_notification::init());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(desktop)]
            crate::os::tray::setup(app)?;

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join(crate::infrastructure::db::DATABASE_FILENAME);
            let pool = tauri::async_runtime::block_on(crate::infrastructure::db::open_database(
                &database_path,
            ))?;
            app.manage(crate::commands::presenter::PresenterState::default());
            let background_pool = pool.clone();
            let background_app = app.handle().clone();
            app.manage(pool);
            tauri::async_runtime::spawn(async move {
                let notifier = crate::os::notifications::NativeNotificationAdapter::new(background_app.clone());
                loop {
                    match crate::application::developer::sync_my_pull_requests_with_notifications(
                        &background_pool,
                        0,
                        100,
                    )
                    .await
                    {
                        Ok((page, notifications)) => {
                            let _ = background_app.emit("pull_request_review_updated", page.clone());
                            let auto_review_enabled = crate::application::developer::get_pull_request_review_settings(&background_pool)
                                .await
                                .map(|settings| settings.auto_review_enabled)
                                .unwrap_or(false);
                            let notifications = if auto_review_enabled {
                                let mut review_tasks = Vec::new();
                                for notification in notifications {
                                    let pull_request = page.values.iter().find(|pull_request| {
                                        pull_request.integration_id == notification.integration_id
                                            && pull_request.project_key == notification.project_key
                                            && pull_request.repository_slug == notification.repository_slug
                                            && pull_request.pull_request_id == notification.pull_request_id
                                    }).cloned();
                                    let Some(pull_request) = pull_request else {
                                        continue;
                                    };
                                    let review_pool = background_pool.clone();
                                    let review_app = background_app.clone();
                                    review_tasks.push(tauri::async_runtime::spawn(async move {
                                        let request = crate::application::developer_review::request_from_pull_request(&pull_request);
                                        let reviewed = crate::application::developer_review::run_review_before_notification(
                                            &review_pool,
                                            &review_app,
                                            request,
                                        )
                                        .await
                                        .is_ok();
                                        (notification, reviewed)
                                    }));
                                }
                                let mut ready = Vec::new();
                                for task in review_tasks {
                                    if let Ok((notification, true)) = task.await {
                                        if let Some(latest_commit) = notification.latest_commit.clone() {
                                            let marked = crate::application::developer::mark_auto_review_completed(
                                                &background_pool,
                                                &notification.integration_id,
                                                &notification.project_key,
                                                &notification.repository_slug,
                                                &notification.pull_request_id,
                                                &latest_commit,
                                            )
                                            .await;
                                            if marked.unwrap_or(false) {
                                                ready.push(notification);
                                            }
                                        }
                                    }
                                }
                                ready
                            } else {
                                notifications
                            };
                            if crate::application::general::notifications_enabled(&background_pool)
                                .await
                                .unwrap_or(true)
                            {
                                for notification in notifications {
                                    let title = match notification.activity {
                                        crate::application::developer::PullRequestActivity::New => {
                                            "New pull request for review"
                                        }
                                        crate::application::developer::PullRequestActivity::Updated => {
                                            "Pull request updated"
                                        }
                                        crate::application::developer::PullRequestActivity::Read => continue,
                                    };
                                    let body = format!(
                                        "{}/{} #{} — {}",
                                        notification.project_key,
                                        notification.repository_slug,
                                        notification.pull_request_id,
                                        notification.title,
                                    );
                                    let _ = crate::os::notifications::NotificationAdapter::notify(
                                        &notifier,
                                        title,
                                        &body,
                                        &notification.key,
                                    );
                                }
                            }
                        }
                        Err(error) => {
                            eprintln!("Pull request background sync failed: {}", error.code);
                        }
                    }
                    tokio::time::sleep(Duration::from_secs(300)).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            crate::os::tray::handle_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::planning::jira_avatar_data,
            commands::daily::daily_workspace,
            commands::daily::daily_workspace_refresh,
            commands::presenter::open_presenter_view,
            commands::presenter::update_presenter_view,
            commands::presenter::presenter_view_state,
            commands::presenter::close_presenter_view,
            greet,
            commands::developer::bitbucket_my_pull_requests,
            commands::developer::bitbucket_my_pull_requests_refresh,
            commands::developer::pull_request_review_start,
            commands::developer::pull_request_review_state,
            commands::developer::pull_request_review_mark_read,
            commands::developer::pull_request_review_mark_all_read,
            commands::developer::bitbucket_search_users,
            commands::developer::bitbucket_search_repositories,
            commands::developer::pull_request_review_settings,
            commands::developer::save_pull_request_review_settings,
            commands::general::general_settings,
            commands::general::general_settings_save,
            commands::general::notification_test,
            commands::general::notification_open_settings,
            commands::ai::ai_settings,
            commands::ai::ai_settings_save,
            commands::inbox::inbox_list,
            commands::inbox::inbox_update_state,
            commands::integrations::integration_list,
            commands::integrations::integration_save,
            commands::integrations::integration_health_check,
            commands::integrations::integration_health_check_all,
            commands::integrations::integration_delete,
            commands::integrations::integration_set_enabled,
            commands::planning::managed_project_list,
            commands::planning::managed_project_save,
            commands::planning::managed_project_delete,
            commands::planning::planning_metadata_capabilities,
            commands::planning::planning_workspace_list,
            commands::planning::planning_managed_projects,
            commands::planning::planning_project_validate,
            commands::planning::planning_project_boards,
            commands::planning::planning_target_sprints,
            commands::planning::planning_workspace,
            commands::planning::planning_draft_save,
            commands::planning::planning_draft_remove,
            commands::planning::planning_team_presets,
            commands::planning::planning_team_preset_save,
            commands::planning::planning_team_preset_remove,
            commands::planning::planning_team_members,
            commands::planning::planning_team_members_configured,
            commands::planning::planning_team_members_search,
            commands::planning::planning_team_member_add,
            commands::planning::planning_team_member_remove,
            commands::planning::planning_team_member_reorder,
            commands::planning::planning_apply_and_lock,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                crate::os::tray::show_and_focus_main_window(_app);
            }
        });
}
