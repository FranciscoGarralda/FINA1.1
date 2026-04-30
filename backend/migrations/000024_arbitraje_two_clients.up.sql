-- Arbitraje: cliente costo (OUT) y cliente cobrado (IN). movements.client_id sigue apuntando al cobrado para listados.
ALTER TABLE movements
    ADD COLUMN IF NOT EXISTS arbitraje_cost_client_id UUID NULL REFERENCES clients (id),
    ADD COLUMN IF NOT EXISTS arbitraje_cobrado_client_id UUID NULL REFERENCES clients (id);

CREATE INDEX IF NOT EXISTS idx_movements_arbitraje_cost_client ON movements (arbitraje_cost_client_id)
    WHERE arbitraje_cost_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_arbitraje_cobrado_client ON movements (arbitraje_cobrado_client_id)
    WHERE arbitraje_cobrado_client_id IS NOT NULL;
