BEGIN;

DROP INDEX IF EXISTS idx_pending_items_resolved_by_movement_id;

ALTER TABLE pending_items
    DROP COLUMN IF EXISTS resolution_note,
    DROP COLUMN IF EXISTS resolved_by_movement_id,
    DROP COLUMN IF EXISTS resolution_mode;

COMMIT;
