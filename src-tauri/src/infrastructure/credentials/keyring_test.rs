use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::keyring::{CredentialError, CredentialStore};

#[derive(Clone, Default)]
struct FakeKeyring {
    values: Arc<Mutex<HashMap<String, String>>>,
}

impl CredentialStore for FakeKeyring {
    fn save(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError> {
        self.values
            .lock()
            .expect("fake keyring lock")
            .insert(credential_ref.to_owned(), secret.to_owned());
        Ok(())
    }

    fn load(&self, credential_ref: &str) -> Result<String, CredentialError> {
        self.values
            .lock()
            .expect("fake keyring lock")
            .get(credential_ref)
            .cloned()
            .ok_or(CredentialError::NotFound)
    }

    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError> {
        self.values
            .lock()
            .expect("fake keyring lock")
            .remove(credential_ref);
        Ok(())
    }
}

#[tokio::test]
async fn fake_keyring_supports_save_load_and_delete() {
    let keyring = FakeKeyring::default();
    let credential_ref = "keyring://sample-repository/jira/account";

    keyring.save(credential_ref, "secret-token").unwrap();
    assert_eq!(keyring.load(credential_ref).unwrap(), "secret-token");
    keyring.delete(credential_ref).unwrap();
    assert_eq!(keyring.load(credential_ref), Err(CredentialError::NotFound));
}

#[tokio::test]
async fn saving_credential_persists_only_reference_in_sqlite() {
    let temp_dir = tempfile::TempDir::new().unwrap();
    let pool = crate::infrastructure::db::open_database(&temp_dir.path().join("mework.sqlite"))
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO integrations
            (id, kind, base_url, account_key, credential_ref, enabled, capabilities_json,
             created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("integration-id")
    .bind("jira")
    .bind("https://jira.example")
    .bind("account")
    .bind("keyring://sample-repository/jira/account")
    .bind(1_i64)
    .bind("{}")
    .bind("2026-09-04T00:00:00Z")
    .bind("2026-09-04T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();

    let keyring = FakeKeyring::default();
    crate::commands::settings::save_integration_credential(
        &pool,
        &keyring,
        "integration-id",
        "keyring://sample-repository/jira/account",
        "secret-token",
    )
    .await
    .unwrap();

    let stored: String =
        sqlx::query_scalar("SELECT credential_ref FROM integrations WHERE id = 'integration-id'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored, "keyring://sample-repository/jira/account");

    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM integrations WHERE credential_ref = 'secret-token'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
    assert_eq!(
        keyring
            .load("keyring://sample-repository/jira/account")
            .unwrap(),
        "secret-token"
    );
}
