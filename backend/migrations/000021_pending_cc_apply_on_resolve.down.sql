BEGIN;

ALTER TABLE pending_items
    DROP COLUMN IF EXISTS cc_apply_on_resolve;

COMMIT;
