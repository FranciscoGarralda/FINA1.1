BEGIN;

CREATE TABLE manual_fx_quotes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency_id UUID NOT NULL REFERENCES currencies(id),
    to_currency_id   UUID NOT NULL REFERENCES currencies(id),
    rate             NUMERIC(20,8) NOT NULL CHECK (rate > 0),
    active           BOOLEAN NOT NULL DEFAULT true,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       UUID NULL REFERENCES users(id),
    UNIQUE(from_currency_id, to_currency_id)
);

COMMIT;
