BEGIN;

ALTER TABLE pending_items
    ADD COLUMN IF NOT EXISTS resolution_mode VARCHAR NULL
        CHECK (resolution_mode IN ('REAL_EXECUTION', 'COMPENSATED')),
    ADD COLUMN IF NOT EXISTS resolved_by_movement_id UUID NULL REFERENCES movements(id),
    ADD COLUMN IF NOT EXISTS resolution_note TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_items_resolved_by_movement_id
    ON pending_items(resolved_by_movement_id);

COMMIT;
