-- =============================================================================
-- Borra de forma definitiva los clientes con client_code 10 y 11.
-- Elimina movimientos y datos CC asociados (orden según FKs del esquema).
--
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/delete-clients-10-11.sql
--      Hacer backup (pg_dump) antes en producción. Usar URL pública si conectás
--      desde fuera de Railway (no postgres.railway.internal).
--
-- Efecto: DELETE movements en cascada sobre líneas, cc_entries, profit_entries,
-- movement_drafts, fx_inventory_ledger. Antes: nulificar resolved_by_movement_id
-- y borrar movement_corrections que referencian esos movimientos.
-- =============================================================================

BEGIN;

UPDATE pending_items
SET resolved_by_movement_id = NULL
WHERE resolved_by_movement_id IN (
    SELECT id FROM movements WHERE client_id IN (
        SELECT id FROM clients WHERE client_code IN (10, 11)
    )
);

DELETE FROM movement_corrections
WHERE source_movement_id IN (
    SELECT id FROM movements WHERE client_id IN (
        SELECT id FROM clients WHERE client_code IN (10, 11)
    )
)
   OR draft_movement_id IN (
    SELECT id FROM movements WHERE client_id IN (
        SELECT id FROM clients WHERE client_code IN (10, 11)
    )
);

DELETE FROM movements
WHERE client_id IN (
    SELECT id FROM clients WHERE client_code IN (10, 11)
);

DELETE FROM cc_balances
WHERE client_id IN (
    SELECT id FROM clients WHERE client_code IN (10, 11)
);

DELETE FROM cc_manual_adjustments
WHERE client_id IN (
    SELECT id FROM clients WHERE client_code IN (10, 11)
);

DELETE FROM clients
WHERE client_code IN (10, 11);

COMMIT;
