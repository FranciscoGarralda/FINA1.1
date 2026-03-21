BEGIN;

CREATE TABLE cc_manual_adjustments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id          UUID NOT NULL REFERENCES clients(id),
    currency_id        UUID NOT NULL REFERENCES currencies(id),
    delta_amount       NUMERIC(20,8) NOT NULL,
    balance_before     NUMERIC(20,8) NOT NULL,
    balance_after      NUMERIC(20,8) NOT NULL,
    origin             VARCHAR NOT NULL CHECK (origin IN ('OPENING_CC', 'MANUAL_CC_ADJUSTMENT')),
    reason             TEXT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cc_manual_adjustments_client_currency_created
    ON cc_manual_adjustments(client_id, currency_id, created_at);

COMMIT;
