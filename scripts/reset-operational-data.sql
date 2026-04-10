-- =============================================================================
-- Reset operativo (Fina): borra TODOS los movimientos y saldos / efectos
-- monetarios derivados. NO borra clientes (incl. #10 y #11), cuentas, divisas
-- ni usuarios.
--
-- Uso: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-operational-data.sql
--      Hacer backup (pg_dump) antes en producción.
--
-- Incluye: gastos, compras/ventas, borradores, pendientes (vía líneas), CC,
-- arqueos, inventario FX, correcciones de movimiento.
-- fx_inventory_ledger se vacía por ON DELETE CASCADE al borrar movements.
-- =============================================================================

BEGIN;

-- Evita bloqueo por FK opcional hacia movimientos de resolución
UPDATE pending_items
SET resolved_by_movement_id = NULL
WHERE resolved_by_movement_id IS NOT NULL;

-- source_movement_id no tiene ON DELETE CASCADE
DELETE FROM movement_corrections;

-- Cascada: movement_lines, pending_items, cc_entries, profit_entries,
-- movement_drafts, fx_inventory_ledger.
DELETE FROM movements;

-- Saldos CC y ajustes manuales (aperturas CC, etc.)
TRUNCATE TABLE cc_balances;
TRUNCATE TABLE cc_manual_adjustments;

-- Posiciones de inventario FX (ledger ya vacío por el DELETE anterior)
TRUNCATE TABLE fx_positions;

-- Historial de arqueos
TRUNCATE TABLE cash_arqueos CASCADE;

-- Reiniciar numeración de operaciones (IDENTITY en movements.operation_number)
ALTER TABLE movements ALTER COLUMN operation_number RESTART WITH 1;

COMMIT;
