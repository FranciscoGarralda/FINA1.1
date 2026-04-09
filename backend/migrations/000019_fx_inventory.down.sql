BEGIN;

DROP TABLE IF EXISTS fx_inventory_ledger;
DROP TABLE IF EXISTS fx_positions;

DELETE FROM system_settings WHERE key = 'fx_functional_currency_code';

COMMIT;
