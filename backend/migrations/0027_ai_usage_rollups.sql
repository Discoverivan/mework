ALTER TABLE ai_token_usage ADD COLUMN request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0);
