DROP INDEX IF EXISTS idx_movements_arbitraje_cobrado_client;
DROP INDEX IF EXISTS idx_movements_arbitraje_cost_client;
ALTER TABLE movements DROP COLUMN IF EXISTS arbitraje_cobrado_client_id;
ALTER TABLE movements DROP COLUMN IF EXISTS arbitraje_cost_client_id;
