use std::time::Duration;

use sqlx::SqlitePool;
use tauri::AppHandle;

use crate::{
    application::ai::{self, AiProviderId, AiProviderStatus},
    infrastructure::db::repositories,
};

const RECOVERY_VERSION_KEY: &str = "ai.codex-cli-update-recovery-version";

fn should_relaunch_codex_after_update(
    provider: Option<AiProviderId>,
    status: AiProviderStatus,
    recovered_version: Option<&str>,
    current_version: &str,
) -> bool {
    provider == Some(AiProviderId::CodexCli)
        && status == AiProviderStatus::NotFound
        && recovered_version != Some(current_version)
}

pub fn recover_codex_after_update(app: AppHandle, pool: SqlitePool) {
    tauri::async_runtime::spawn(async move {
        // MSI starts the app itself while finishing an update. A normal second
        // launch restores CLI discovery on affected Windows installations.
        tokio::time::sleep(Duration::from_secs(10)).await;
        let Ok(settings) = ai::load(&pool).await else {
            return;
        };
        if settings.provider != Some(AiProviderId::CodexCli) {
            return;
        }
        let version = app.package_info().version.to_string();
        let Ok(recovered_version) = repositories::get_setting(&pool, RECOVERY_VERSION_KEY).await
        else {
            return;
        };
        let recovered_version =
            recovered_version.and_then(|value| serde_json::from_str::<String>(&value).ok());
        if recovered_version.as_deref() == Some(version.as_str()) {
            return;
        }
        let Ok(provider) = tokio::task::spawn_blocking(ai::inspect_codex_cli).await else {
            return;
        };
        if !should_relaunch_codex_after_update(
            settings.provider,
            provider.status,
            recovered_version.as_deref(),
            &version,
        ) {
            return;
        }
        let Ok(stored_version) = serde_json::to_string(&version) else {
            return;
        };
        if repositories::upsert_setting(&pool, RECOVERY_VERSION_KEY, &stored_version, 1)
            .await
            .is_ok()
        {
            app.request_restart();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relaunches_once_when_selected_codex_is_missing_after_an_update() {
        assert!(should_relaunch_codex_after_update(
            Some(AiProviderId::CodexCli),
            AiProviderStatus::NotFound,
            Some("0.2.4"),
            "0.2.5",
        ));
        assert!(!should_relaunch_codex_after_update(
            Some(AiProviderId::CodexCli),
            AiProviderStatus::NotFound,
            Some("0.2.5"),
            "0.2.5",
        ));
    }
}
