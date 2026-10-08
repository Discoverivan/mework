use super::scheduler::SyncScheduler;

#[test]
fn coalesces_concurrent_sync_requests_per_integration() {
    let scheduler = SyncScheduler::default();

    assert!(scheduler.try_queue("integration-id"));
    assert!(!scheduler.try_queue("integration-id"));

    scheduler.finish("integration-id");
    assert!(scheduler.try_queue("integration-id"));
}
