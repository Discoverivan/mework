use crate::infrastructure::credentials::keyring::{CredentialError, CredentialStore};

pub async fn save_integration_credential<S: CredentialStore>(
    pool: &sqlx::SqlitePool,
    store: &S,
    integration_id: &str,
    credential_ref: &str,
    secret: &str,
) -> Result<(), CredentialError> {
    store.save(credential_ref, secret)?;

    sqlx::query(
        "UPDATE integrations
         SET credential_ref = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?",
    )
    .bind(credential_ref)
    .bind("2026-09-04T00:00:00Z")
    .bind(integration_id)
    .execute(pool)
    .await
    .map_err(|_| CredentialError::Database)?;

    Ok(())
}
