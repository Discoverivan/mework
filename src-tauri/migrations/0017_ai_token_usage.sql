CREATE TABLE ai_token_usage (
    recorded_at TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL CHECK (total_tokens >= 0)
);

CREATE INDEX idx_ai_token_usage_recorded_at
    ON ai_token_usage(recorded_at);
