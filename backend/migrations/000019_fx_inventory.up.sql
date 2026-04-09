BEGIN;

-- Moneda funcional del costo (JSON string), p. ej. "ARS". Las COMPRA/VENTA deben cotizar en esta moneda para mover inventario FX.
INSERT INTO system_settings (key, value_json, updated_at)
VALUES ('fx_functional_currency_code', '"ARS"', now())
ON CONFLICT (key) DO NOTHING;

-- Posición de inventario por divisa negociada (cantidad en esa divisa; costo total en moneda funcional).
CREATE TABLE fx_positions (
    traded_currency_id UUID PRIMARY KEY REFERENCES currencies(id) ON DELETE RESTRICT,
    quantity           NUMERIC(30, 12) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    total_cost_functional NUMERIC(30, 12) NOT NULL DEFAULT 0 CHECK (total_cost_functional >= 0),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger idempotente: un APPLY por movimiento confirmado COMPRA/VENTA; un REVERSE al anular.
CREATE TABLE fx_inventory_ledger (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_id             UUID NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    effect                  VARCHAR NOT NULL CHECK (effect IN ('APPLY', 'REVERSE')),
    traded_currency_id      UUID NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
    functional_currency_id  UUID NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
    quantity_delta          NUMERIC(30, 12) NOT NULL,
    cost_delta_functional   NUMERIC(30, 12) NOT NULL,
    realized_pnl_functional NUMERIC(30, 12) NOT NULL,
    avg_cost_before         NUMERIC(30, 12) NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (movement_id, effect)
);

CREATE INDEX idx_fx_inventory_ledger_movement ON fx_inventory_ledger (movement_id);
CREATE INDEX idx_fx_inventory_ledger_created ON fx_inventory_ledger (created_at);

COMMENT ON TABLE fx_positions IS 'Inventario FX de la mesa: cantidad por divisa negociada, costo acumulado en moneda funcional (ver system_settings fx_functional_currency_code).';
COMMENT ON TABLE fx_inventory_ledger IS 'Efectos de inventario FX por movimiento COMPRA/VENTA; APPLY al confirmar, REVERSE al cancelar. realized_pnl_functional solo en ventas (compra = 0).';

COMMIT;
