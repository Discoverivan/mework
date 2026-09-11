use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct SyncScheduler {
    active_integrations: Arc<Mutex<HashSet<String>>>,
}

impl SyncScheduler {
    pub fn try_queue(&self, integration_id: &str) -> bool {
        self.active_integrations
            .lock()
            .expect("sync scheduler lock")
            .insert(integration_id.to_owned())
    }

    pub fn finish(&self, integration_id: &str) {
        self.active_integrations
            .lock()
            .expect("sync scheduler lock")
            .remove(integration_id);
    }
}
