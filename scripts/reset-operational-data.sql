-- =============================================================================
-- RESETEO OPERATIVO — Fina (Postgres)
-- =============================================================================
-- Borra TODOS los clientes, movimientos, CC, pendientes, arqueos de caja y
-- filas de audit_logs. NO borra: users, currencies, accounts, system_settings,
-- permissions / role_permissions / user_permissions.
--
-- Irreversible. Hacer backup o snapshot del Postgres antes.
--
-- Desde la raíz del repo:
--   export DATABASE_URL='(solo en tu terminal, desde Railway)'
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-operational-data.sql
-- =============================================================================

BEGIN;

DELETE FROM movement_corrections;
DELETE FROM pending_items;
DELETE FROM cc_entries;
DELETE FROM profit_entries;
DELETE FROM movement_lines;
DELETE FROM movement_drafts;
DELETE FROM movements;
DELETE FROM cc_manual_adjustments;
DELETE FROM cc_balances;
DELETE FROM cash_arqueo_lines;
DELETE FROM cash_arqueos;
DELETE FROM clients;
DELETE FROM audit_logs;

ALTER TABLE clients ALTER COLUMN client_code RESTART WITH 1;
ALTER TABLE movements ALTER COLUMN operation_number RESTART WITH 1;

COMMIT;

SELECT
  (SELECT COUNT(*) FROM clients) AS clients,
  (SELECT COUNT(*) FROM movements) AS movements,
  (SELECT COUNT(*) FROM pending_items) AS pending_items,
  (SELECT COUNT(*) FROM cc_balances) AS cc_balances,
  (SELECT COUNT(*) FROM audit_logs) AS audit_logs;
