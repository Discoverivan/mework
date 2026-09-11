#[cfg(debug_assertions)]
use crate::domain::models::IntegrationKind;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum CredentialError {
    Backend,
    Database,
    NotFound,
}

pub trait CredentialStore: Send + Sync {
    fn save(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError>;
    fn load(&self, credential_ref: &str) -> Result<String, CredentialError>;
    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError>;
}

#[cfg(debug_assertions)]
#[derive(Debug, Default, Clone)]
pub struct DevCredentialStore {
    secrets: std::collections::HashMap<String, String>,
}

#[cfg(debug_assertions)]
impl DevCredentialStore {
    pub fn from_integrations<I>(entries: I) -> Self
    where
        I: IntoIterator<Item = (String, IntegrationKind)>,
    {
        let mut store = Self::default();
        for (credential_ref, kind) in entries {
            let variable = match kind {
                IntegrationKind::Jira => "MEWORK_DEV_JIRA_PAT",
                IntegrationKind::Bitbucket => "MEWORK_DEV_BITBUCKET_PAT",
            };
            if let Ok(secret) = std::env::var(variable) {
                if !secret.trim().is_empty() {
                    store.secrets.insert(credential_ref, secret);
                }
            }
        }
        store
    }

    pub fn from_secret(credential_ref: impl Into<String>, secret: impl Into<String>) -> Self {
        let mut store = Self::default();
        store.secrets.insert(credential_ref.into(), secret.into());
        store
    }
}

#[cfg(debug_assertions)]
impl CredentialStore for DevCredentialStore {
    fn save(&self, _credential_ref: &str, _secret: &str) -> Result<(), CredentialError> {
        Ok(())
    }

    fn load(&self, credential_ref: &str) -> Result<String, CredentialError> {
        self.secrets
            .get(credential_ref)
            .cloned()
            .ok_or(CredentialError::NotFound)
    }

    fn delete(&self, _credential_ref: &str) -> Result<(), CredentialError> {
        Ok(())
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::{CredentialStore, DevCredentialStore};

    #[test]
    #[cfg(debug_assertions)]
    fn development_store_reads_only_the_in_memory_dev_secret() {
        let store = DevCredentialStore::from_secret("dev://bitbucket", "not-a-real-token");
        assert_eq!(store.load("dev://bitbucket").unwrap(), "not-a-real-token");
        assert!(store.load("keyring://missing").is_err());
        store.save("dev://bitbucket", "ignored").unwrap();
        store.delete("dev://bitbucket").unwrap();
    }
}

#[derive(Debug, Clone)]
pub struct OsKeyring {
    service: String,
}

impl OsKeyring {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, credential_ref: &str) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(&self.service, credential_ref).map_err(|_| CredentialError::Backend)
    }
}

impl CredentialStore for OsKeyring {
    fn save(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError> {
        self.entry(credential_ref)?
            .set_password(secret)
            .map_err(|_| CredentialError::Backend)
    }

    fn load(&self, credential_ref: &str) -> Result<String, CredentialError> {
        self.entry(credential_ref)?
            .get_password()
            .map_err(|_| CredentialError::NotFound)
    }

    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError> {
        self.entry(credential_ref)?
            .delete_credential()
            .map_err(|_| CredentialError::Backend)
    }
}
