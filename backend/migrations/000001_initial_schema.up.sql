BEGIN;

-- =============================================================================
-- A) users
-- =============================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR NOT NULL UNIQUE,
    password_hash   VARCHAR NOT NULL,
    role            VARCHAR NOT NULL,
    pin_hash        VARCHAR NULL,
    active          BOOLEAN NOT NULL DEFAULT true,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- B) currencies
-- =============================================================================
CREATE TABLE currencies (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR NOT NULL UNIQUE,
    name        VARCHAR NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- C) accounts
-- =============================================================================
CREATE TABLE accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- D) account_currencies
-- =============================================================================
CREATE TABLE account_currencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    currency_id     UUID NOT NULL REFERENCES currencies(id),
    cash_enabled    BOOLEAN NOT NULL DEFAULT true,
    digital_enabled BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(account_id, currency_id)
);

-- =============================================================================
-- E) clients
-- =============================================================================
CREATE TABLE clients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_code       BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    first_name        VARCHAR NOT NULL,
    last_name         VARCHAR NOT NULL,
    phone             VARCHAR NOT NULL,
    dni               VARCHAR NOT NULL,
    address_street    VARCHAR NOT NULL,
    address_number    VARCHAR NOT NULL,
    address_floor     VARCHAR NOT NULL,
    reference_contact VARCHAR NOT NULL,
    referred_by       VARCHAR NOT NULL,
    active            BOOLEAN NOT NULL DEFAULT true,
    cc_enabled        BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- F) movements (operation header)
-- =============================================================================
CREATE TABLE movements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_number    BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    type                VARCHAR NOT NULL,
    date                DATE NOT NULL,
    day_name            VARCHAR NOT NULL,
    status              VARCHAR NOT NULL DEFAULT 'CONFIRMADA',
    client_id           UUID NULL REFERENCES clients(id),
    created_by_user_id  UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    note                TEXT NULL
);

-- =============================================================================
-- G) movement_lines (real money lines)
-- =============================================================================
CREATE TABLE movement_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_id     UUID NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    side            VARCHAR NOT NULL CHECK (side IN ('IN','OUT')),
    account_id      UUID NOT NULL REFERENCES accounts(id),
    currency_id     UUID NOT NULL REFERENCES currencies(id),
    format          VARCHAR NOT NULL CHECK (format IN ('CASH','DIGITAL')),
    amount          NUMERIC(20,8) NOT NULL CHECK (amount > 0),
    is_pending      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_movement_lines_movement_id ON movement_lines(movement_id);
CREATE INDEX idx_movement_lines_account_id ON movement_lines(account_id);
CREATE INDEX idx_movement_lines_currency_id ON movement_lines(currency_id);

-- =============================================================================
-- H) pending_items
-- =============================================================================
CREATE TABLE pending_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_line_id    UUID NOT NULL UNIQUE REFERENCES movement_lines(id) ON DELETE CASCADE,
    type                VARCHAR NOT NULL CHECK (type IN ('PENDIENTE_DE_PAGO','PENDIENTE_DE_RETIRO')),
    status              VARCHAR NOT NULL DEFAULT 'ABIERTO' CHECK (status IN ('ABIERTO','RESUELTO','CANCELADO')),
    client_id           UUID NOT NULL REFERENCES clients(id),
    currency_id         UUID NOT NULL REFERENCES currencies(id),
    amount              NUMERIC(20,8) NOT NULL CHECK (amount > 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ NULL,
    resolved_by_user_id UUID NULL REFERENCES users(id)
);

-- =============================================================================
-- I) cc_balances
-- =============================================================================
CREATE TABLE cc_balances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    balance     NUMERIC(20,8) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(client_id, currency_id)
);

-- =============================================================================
-- J) cc_entries
-- =============================================================================
CREATE TABLE cc_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   UUID NOT NULL REFERENCES clients(id),
    currency_id UUID NOT NULL REFERENCES currencies(id),
    amount      NUMERIC(20,8) NOT NULL,
    movement_id UUID NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    note        TEXT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cc_entries_client_currency_created ON cc_entries(client_id, currency_id, created_at);

-- =============================================================================
-- K) profit_entries
-- =============================================================================
CREATE TABLE profit_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_id UUID NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    currency_id UUID NOT NULL REFERENCES currencies(id),
    amount      NUMERIC(20,8) NOT NULL,
    account_id  UUID NOT NULL REFERENCES accounts(id),
    format      VARCHAR NOT NULL CHECK (format IN ('CASH','DIGITAL')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- L) audit_logs
-- =============================================================================
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR NOT NULL,
    entity_id   UUID NULL,
    action      VARCHAR NOT NULL,
    before_json JSONB NULL,
    after_json  JSONB NULL,
    user_id     UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
