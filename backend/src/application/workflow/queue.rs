use std::collections::VecDeque;

#[derive(Debug)]
pub struct WorkflowQueue {
    limit: usize,
    running: usize,
    queued: VecDeque<String>,
}

impl WorkflowQueue {
    pub fn new(limit: usize) -> Self {
        Self {
            limit: limit.max(1),
            running: 0,
            queued: VecDeque::new(),
        }
    }

    pub fn enqueue(&mut self, run_id: String) {
        self.queued.push_back(run_id);
    }

    pub fn start_next(&mut self) -> Option<String> {
        if self.running >= self.limit {
            return None;
        }
        let run_id = self.queued.pop_front()?;
        self.running += 1;
        Some(run_id)
    }

    pub fn finish_one(&mut self) {
        self.running = self.running.saturating_sub(1);
    }
}
