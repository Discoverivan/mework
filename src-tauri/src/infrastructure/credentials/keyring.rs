use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};

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

pub const DEV_KEYRING_SERVICE: &str = "com.discoverivan.app.mework.dev";
pub const PRODUCTION_KEYRING_SERVICE: &str = "com.discoverivan.app.mework";
const BUNDLE_CREDENTIAL_REF: &str = "__mework_credential_bundle__";

#[derive(Debug, Deserialize, Serialize)]
struct CredentialBundle {
    values: HashMap<String, String>,
}

#[derive(Debug, Default)]
struct CredentialCache {
    values: Mutex<HashMap<(String, String), String>>,
    missing: Mutex<HashSet<(String, String)>>,
}

impl CredentialCache {
    #[cfg(test)]
    fn get(&self, service: &str, credential_ref: &str) -> Option<String> {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&(service.to_owned(), credential_ref.to_owned()))
            .cloned()
    }

    fn get_or_load<F>(
        &self,
        service: &str,
        credential_ref: &str,
        load: F,
    ) -> Result<String, CredentialError>
    where
        F: FnOnce() -> Result<String, CredentialError>,
    {
        let key = (service.to_owned(), credential_ref.to_owned());
        let mut values = self
            .values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(value) = values.get(&key) {
            return Ok(value.clone());
        }
        if self
            .missing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(&key)
        {
            return Err(CredentialError::NotFound);
        }
        let value = match load() {
            Ok(value) => value,
            Err(error) => {
                if error == CredentialError::NotFound {
                    self.missing
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .insert(key);
                }
                return Err(error);
            }
        };
        values.insert(key, value.clone());
        Ok(value)
    }

    fn insert(&self, service: &str, credential_ref: &str, value: &str) {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (service.to_owned(), credential_ref.to_owned()),
                value.to_owned(),
            );
        self.missing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&(service.to_owned(), credential_ref.to_owned()));
    }

    fn mark_missing(&self, service: &str, credential_ref: &str) {
        self.missing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert((service.to_owned(), credential_ref.to_owned()));
    }

    fn remove(&self, service: &str, credential_ref: &str) {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&(service.to_owned(), credential_ref.to_owned()));
        self.missing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&(service.to_owned(), credential_ref.to_owned()));
    }
}

static CREDENTIAL_CACHE: OnceLock<CredentialCache> = OnceLock::new();

fn credential_cache() -> &'static CredentialCache {
    CREDENTIAL_CACHE.get_or_init(CredentialCache::default)
}

#[derive(Debug, Default)]
struct BundleCache {
    values: Mutex<HashMap<String, Option<HashMap<String, String>>>>,
}

impl BundleCache {
    fn get(&self, service: &str) -> Option<Option<HashMap<String, String>>> {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(service)
            .cloned()
    }

    fn set(&self, service: &str, values: Option<HashMap<String, String>>) {
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(service.to_owned(), values);
    }
}

static BUNDLE_CACHE: OnceLock<BundleCache> = OnceLock::new();

fn bundle_cache() -> &'static BundleCache {
    BUNDLE_CACHE.get_or_init(BundleCache::default)
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

    /// Preload all requested credentials from one protected bundle item.
    ///
    /// The bundle contains all configured credential values for this app
    /// namespace, so startup needs one Keychain item read. Existing installs
    /// without a bundle are not read item-by-item automatically because macOS
    /// can show one authorization prompt per legacy item; users can re-save
    /// those credentials through Settings to populate the bundle.
    pub fn preload(&self, credential_refs: &[String]) -> Result<(), CredentialError> {
        let requested = credential_refs
            .iter()
            .filter(|credential_ref| !credential_ref.trim().is_empty())
            .cloned()
            .collect::<HashSet<_>>();
        if requested.is_empty() {
            return Ok(());
        }

        let Some(values) = self.read_bundle()? else {
            for credential_ref in requested {
                credential_cache().mark_missing(&self.service, &credential_ref);
            }
            return Ok(());
        };
        for credential_ref in requested {
            if let Some(value) = values.get(&credential_ref) {
                credential_cache().insert(&self.service, &credential_ref, value);
            } else {
                credential_cache().mark_missing(&self.service, &credential_ref);
            }
        }
        Ok(())
    }

    fn read_bundle(&self) -> Result<Option<HashMap<String, String>>, CredentialError> {
        if let Some(values) = bundle_cache().get(&self.service) {
            return Ok(values);
        }
        let raw = match self.entry(BUNDLE_CREDENTIAL_REF)?.get_password() {
            Ok(raw) => raw,
            Err(_) => {
                bundle_cache().set(&self.service, None);
                return Ok(None);
            }
        };
        let bundle =
            serde_json::from_str::<CredentialBundle>(&raw).map_err(|_| CredentialError::Backend)?;
        bundle_cache().set(&self.service, Some(bundle.values.clone()));
        Ok(Some(bundle.values))
    }

    fn write_bundle(&self, values: &HashMap<String, String>) -> Result<(), CredentialError> {
        let raw = serde_json::to_string(&CredentialBundle {
            values: values.clone(),
        })
        .map_err(|_| CredentialError::Backend)?;
        self.entry(BUNDLE_CREDENTIAL_REF)?
            .set_password(&raw)
            .map_err(|_| CredentialError::Backend)?;
        bundle_cache().set(&self.service, Some(values.clone()));
        Ok(())
    }
}

impl CredentialStore for OsKeyring {
    fn save(&self, credential_ref: &str, secret: &str) -> Result<(), CredentialError> {
        let mut values = self.read_bundle()?.unwrap_or_default();
        values.insert(credential_ref.to_owned(), secret.to_owned());
        self.write_bundle(&values)?;
        credential_cache().insert(&self.service, credential_ref, secret);
        Ok(())
    }

    fn load(&self, credential_ref: &str) -> Result<String, CredentialError> {
        credential_cache().get_or_load(&self.service, credential_ref, || {
            if let Some(bundle) = self.read_bundle()? {
                if let Some(secret) = bundle.get(credential_ref) {
                    return Ok(secret.clone());
                }
            }
            self.entry(credential_ref)?
                .get_password()
                .map_err(|_| CredentialError::NotFound)
        })
    }

    fn delete(&self, credential_ref: &str) -> Result<(), CredentialError> {
        let mut bundle = self.read_bundle()?.unwrap_or_default();
        if bundle.remove(credential_ref).is_some() {
            if bundle.is_empty() {
                self.entry(BUNDLE_CREDENTIAL_REF)?
                    .delete_credential()
                    .map_err(|_| CredentialError::Backend)?;
                bundle_cache().set(&self.service, None);
            } else {
                self.write_bundle(&bundle)?;
            }
        } else {
            self.entry(credential_ref)?
                .delete_credential()
                .map_err(|_| CredentialError::Backend)?;
        }
        credential_cache().remove(&self.service, credential_ref);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{OsKeyring, DEV_KEYRING_SERVICE, PRODUCTION_KEYRING_SERVICE};

    #[test]
    fn exposes_separate_dev_and_production_keyring_namespaces() {
        let dev = OsKeyring::new(DEV_KEYRING_SERVICE);
        let production = OsKeyring::new(PRODUCTION_KEYRING_SERVICE);
        assert_eq!(dev.service, DEV_KEYRING_SERVICE);
        assert_eq!(production.service, PRODUCTION_KEYRING_SERVICE);
        assert_ne!(dev.service, production.service);
    }

    #[test]
    fn credential_cache_reuses_values_per_service_and_reference() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let cache = super::CredentialCache::default();
        let loads = AtomicUsize::new(0);

        let first = cache
            .get_or_load("com.example.dev", "credential-a", || {
                loads.fetch_add(1, Ordering::SeqCst);
                Ok("synthetic-token".to_owned())
            })
            .unwrap();
        let second = cache
            .get_or_load("com.example.dev", "credential-a", || {
                loads.fetch_add(1, Ordering::SeqCst);
                Ok("unexpected-token".to_owned())
            })
            .unwrap();

        assert_eq!(first, "synthetic-token");
        assert_eq!(second, "synthetic-token");
        assert_eq!(loads.load(Ordering::SeqCst), 1);
        assert_eq!(cache.get("com.example.prod", "credential-a"), None);
        cache.remove("com.example.dev", "credential-a");
        assert_eq!(cache.get("com.example.dev", "credential-a"), None);
    }

    #[test]
    fn credential_cache_remembers_preloaded_missing_references() {
        let cache = super::CredentialCache::default();
        cache.mark_missing("com.example.dev", "credential-a");
        let result = cache.get_or_load("com.example.dev", "credential-a", || {
            panic!("a preloaded missing reference must not hit Keychain again")
        });
        assert_eq!(result, Err(super::CredentialError::NotFound));
        cache.insert("com.example.dev", "credential-a", "synthetic-token");
        assert_eq!(
            cache
                .get_or_load("com.example.dev", "credential-a", || {
                    panic!("a preloaded value must be served from cache")
                })
                .unwrap(),
            "synthetic-token"
        );
    }
}
