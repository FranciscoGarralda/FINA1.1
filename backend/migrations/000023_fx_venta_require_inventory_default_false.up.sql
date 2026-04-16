BEGIN;

-- Operativa por defecto: no bloquear ventas por stock FX. Opt-in: value_json = true en fx_venta_require_inventory.
INSERT INTO system_settings (key, value_json, updated_at)
VALUES ('fx_venta_require_inventory', 'false'::jsonb, now())
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at;

COMMIT;
