ALTER TABLE inbox_items ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox_items ADD COLUMN project TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox_items ADD COLUMN object_type TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox_items ADD COLUMN external_id TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox_items ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE inbox_items ADD COLUMN snooze_until TEXT;
ALTER TABLE inbox_items ADD COLUMN following INTEGER NOT NULL DEFAULT 0 CHECK (following IN (0, 1));

CREATE INDEX idx_inbox_items_snooze ON inbox_items(snooze_until);
CREATE INDEX idx_inbox_items_following ON inbox_items(following);
