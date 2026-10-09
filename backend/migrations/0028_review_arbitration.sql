CREATE TABLE review_arbitration_stages (
    run_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    object_type TEXT NOT NULL DEFAULT 'pull_request',
    external_id TEXT NOT NULL,
    reviewed_commit TEXT,
    stage TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, stage)
);
CREATE INDEX review_arbitration_stages_created_at ON review_arbitration_stages(created_at);
