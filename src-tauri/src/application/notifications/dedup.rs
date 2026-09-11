use std::collections::HashSet;

#[derive(Default)]
pub struct NotificationDeduplicator {
    delivered: HashSet<String>,
}

impl NotificationDeduplicator {
    pub fn claim(&mut self, dedupe_key: &str) -> bool {
        self.delivered.insert(dedupe_key.to_owned())
    }
}
