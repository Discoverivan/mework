CREATE TABLE review_discussion_contexts (
    run_id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL,
    object_type TEXT NOT NULL DEFAULT 'pull_request',
    external_id TEXT NOT NULL,
    reviewed_commit TEXT,
    diff TEXT NOT NULL,
    manifest_json TEXT
);

CREATE TABLE review_comment_discussions (
    run_id TEXT NOT NULL REFERENCES review_discussion_contexts(run_id) ON DELETE CASCADE,
    comment_index INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (run_id, comment_index)
);
