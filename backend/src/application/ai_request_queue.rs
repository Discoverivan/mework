//! Provider-scoped admission and cooldowns. Waiting never consumes a transport timeout.
use std::{
    cell::RefCell,
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use super::ai_usage_statistics::{self, AiTokenUsageCounts};

const PARALLEL_REQUESTS: usize = 2;
const DEFAULT_COOLDOWN_SECONDS: i64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewProgress {
    pub phase: WaitPhase,
    pub retry_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WaitPhase {
    Queued,
    WaitingQuota,
}

#[derive(Clone)]
struct ReviewContext {
    run_id: String,
    pool: SqlitePool,
}
thread_local! { static CONTEXT: RefCell<Option<ReviewContext>> = const { RefCell::new(None) }; }

pub(super) fn run_id() -> Option<String> {
    CONTEXT.with(|c| c.borrow().as_ref().map(|context| context.run_id.clone()))
}

pub(super) fn with_review<T>(run_id: &str, pool: &SqlitePool, call: impl FnOnce() -> T) -> T {
    struct Restore(Option<ReviewContext>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CONTEXT.with(|c| c.replace(self.0.take()));
        }
    }
    let _restore = Restore(CONTEXT.with(|c| {
        c.replace(Some(ReviewContext {
            run_id: run_id.into(),
            pool: pool.clone(),
        }))
    }));
    call()
}

// All measured review attempts, including rejected formatting responses, are durable.
pub(super) async fn account_usage(
    provider: &str,
    model: &str,
    counts: Option<AiTokenUsageCounts>,
) -> Result<Option<AiTokenUsageCounts>, String> {
    let context = CONTEXT.with(|c| c.borrow().clone());
    if let (Some(context), Some(counts)) = (context, counts) {
        ai_usage_statistics::record_now(&context.pool, provider, model, counts)
            .await
            .map_err(|_| "Failed to record review usage".to_owned())?;
        Ok(None)
    } else {
        Ok(counts)
    }
}

struct ProviderQueue {
    permits: Arc<Semaphore>,
    retry_at: Mutex<i64>,
}
impl ProviderQueue {
    fn new() -> Self {
        Self {
            permits: Arc::new(Semaphore::new(PARALLEL_REQUESTS)),
            retry_at: Mutex::new(0),
        }
    }
}
static QUEUES: OnceLock<Mutex<HashMap<String, Arc<ProviderQueue>>>> = OnceLock::new();
type Waits = HashMap<String, HashMap<u64, Option<ReviewProgress>>>;
static WAITS: OnceLock<Mutex<Waits>> = OnceLock::new();
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn queue(key: &str) -> Arc<ProviderQueue> {
    QUEUES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(key.into())
        .or_insert_with(|| Arc::new(ProviderQueue::new()))
        .clone()
}
pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

pub(super) fn http_key(base_url: &str, token: &str) -> String {
    // An ephemeral opaque identity separates accounts at the same endpoint. Never log it.
    let mut hash = Sha256::new();
    hash.update(base_url.trim_end_matches('/').as_bytes());
    hash.update([0]);
    hash.update(token.as_bytes());
    format!(
        "http:{}",
        hash.finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}
pub(super) fn cli_key(model: &str) -> String {
    format!("opencode:{}", model.split('/').next().unwrap_or(model))
}

pub(super) fn admit_cli(settings: &super::ai::AiSettings) -> Result<Option<Permit>, String> {
    use super::ai::AiProviderId;
    match settings.provider {
        None | Some(AiProviderId::OpenCodeCli | AiProviderId::OpenAiCompatible) => Ok(None),
        Some(provider) => {
            let key = format!(
                "cli:{}",
                serde_json::to_string(&provider).expect("Provider ID is serializable")
            );
            tauri::async_runtime::block_on(acquire(&key)).map(Some)
        }
    }
}

struct Registration {
    run: Option<String>,
    id: u64,
}
impl Registration {
    fn new() -> Self {
        Self {
            run: CONTEXT.with(|c| c.borrow().as_ref().map(|c| c.run_id.clone())),
            id: NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        }
    }
    fn set(&self, state: Option<ReviewProgress>) {
        if let Some(run) = &self.run {
            WAITS
                .get_or_init(Default::default)
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .entry(run.clone())
                .or_default()
                .insert(self.id, state);
        }
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(run) = &self.run {
            let mut waits = WAITS
                .get_or_init(Default::default)
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if let Some(entries) = waits.get_mut(run) {
                entries.remove(&self.id);
                if entries.is_empty() {
                    waits.remove(run);
                }
            }
        }
    }
}
pub(super) fn progress(run: &str) -> Option<ReviewProgress> {
    let waits = WAITS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let entries = waits.get(run)?;
    if entries.values().any(Option::is_none) {
        return None;
    }
    entries
        .values()
        .flatten()
        .find(|s| s.phase == WaitPhase::WaitingQuota)
        .cloned()
        .or_else(|| entries.values().flatten().next().cloned())
}

pub(super) struct Permit {
    _permit: OwnedSemaphorePermit,
    _registration: Registration,
}
async fn cancelled(cancellation: Option<Arc<super::ai_providers::cli::CliCancellation>>) {
    let Some(cancellation) = cancellation else {
        return std::future::pending().await;
    };
    while !cancellation.is_cancelled() {
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

pub(super) async fn acquire(key: &str) -> Result<Permit, String> {
    let queue = queue(key);
    let registration = Registration::new();
    let cancellation = super::ai_providers::cli::request_cancellation();
    loop {
        let retry_at = *queue.retry_at.lock().unwrap_or_else(|e| e.into_inner());
        if retry_at > now_ms() {
            registration.set(Some(ReviewProgress {
                phase: WaitPhase::WaitingQuota,
                retry_at: Some(retry_at),
            }));
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis((retry_at - now_ms()).max(1) as u64)) => {},
                _ = cancelled(cancellation.clone()) => return Err("AI request cancelled".into()),
            }
            continue;
        }
        registration.set(Some(ReviewProgress {
            phase: WaitPhase::Queued,
            retry_at: None,
        }));
        let permit = tokio::select! {
            permit = queue.permits.clone().acquire_owned() => permit.expect("Provider queue is never closed"),
            _ = cancelled(cancellation.clone()) => return Err("AI request cancelled".into()),
        };
        if *queue.retry_at.lock().unwrap_or_else(|e| e.into_inner()) > now_ms() {
            drop(permit);
            continue;
        }
        registration.set(None);
        return Ok(Permit {
            _permit: permit,
            _registration: registration,
        });
    }
}

pub(super) fn defer(key: &str, retry_at: Option<i64>) -> String {
    let queue = queue(key);
    let mut until = queue.retry_at.lock().unwrap_or_else(|e| e.into_inner());
    *until = (*until)
        .max(retry_at.unwrap_or_else(|| now_ms() + DEFAULT_COOLDOWN_SECONDS * 1000))
        .clamp(now_ms() + 1000, now_ms() + 24 * 60 * 60 * 1000);
    // Only application-owned codes and numeric timestamps cross the renderer boundary.
    super::logging::info(
        "ai.queue",
        "provider_cooldown",
        serde_json::json!({"runId":run_id(),"retryAt":*until}),
    );
    format!("ai_provider_rate_limit:{}", *until)
}

pub(super) fn limit_error(key: &str) -> String {
    format!(
        "ai_provider_rate_limit:{}",
        *queue(key)
            .retry_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    )
}

pub(super) fn retry_after(value: &str) -> Option<i64> {
    if let Ok(seconds) = value.trim().parse::<u32>() {
        return Some(now_ms().saturating_add(i64::from(seconds) * 1000));
    }
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc2822)
        .ok()
        .map(|t| t.unix_timestamp() * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn queues_requests_per_account_and_observes_cooldown_before_admission() {
        let key = "example-queue";
        let a = acquire(key).await.unwrap();
        let b = acquire(key).await.unwrap();
        let pending = tokio::spawn(async { acquire("example-queue").await.unwrap() });
        tokio::task::yield_now().await;
        assert!(!pending.is_finished());
        let other = acquire("example-other-account").await.unwrap();
        defer(key, Some(now_ms() + 25));
        drop(a);
        drop(b);
        drop(other);
        let _admitted = pending.await.unwrap();
        assert!(*queue(key).retry_at.lock().unwrap() <= now_ms());
    }
}
