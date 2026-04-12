BEGIN;

-- true = CC omitida al confirmar; aplicar en REAL_EXECUTION (resolve).
-- false = legado (CC ya al confirmar) o pendiente sin CC en resolve (p. ej. apertura).
ALTER TABLE pending_items
    ADD COLUMN IF NOT EXISTS cc_apply_on_resolve BOOLEAN NOT NULL DEFAULT false;

COMMIT;
