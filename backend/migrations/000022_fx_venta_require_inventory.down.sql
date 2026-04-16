BEGIN;

DELETE FROM system_settings WHERE key = 'fx_venta_require_inventory';

COMMIT;
