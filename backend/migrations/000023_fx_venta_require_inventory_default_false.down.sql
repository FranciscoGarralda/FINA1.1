BEGIN;

-- Revierte el default operativo de 000023 (exigencia estricta previa).
UPDATE system_settings SET value_json = 'true'::jsonb, updated_at = now()
WHERE key = 'fx_venta_require_inventory';

COMMIT;
