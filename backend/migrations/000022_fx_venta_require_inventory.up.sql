BEGIN;

-- Si true (default): VENTA y TRANSFERENCIA que usan applyVentaTx exigen stock en fx_positions.
-- Si false: sin stock o insuficiente se omite el APPLY FX completo (todo o nada; sin consumo parcial).
INSERT INTO system_settings (key, value_json, updated_at)
VALUES ('fx_venta_require_inventory', 'true'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

COMMIT;
