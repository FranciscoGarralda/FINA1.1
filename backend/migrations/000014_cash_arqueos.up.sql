BEGIN;

CREATE TABLE cash_arqueos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES accounts(id),
    arqueo_date         DATE NOT NULL,
    note                TEXT NULL,
    created_by_user_id  UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_arqueos_account_created ON cash_arqueos(account_id, created_at DESC);
CREATE INDEX idx_cash_arqueos_account_date ON cash_arqueos(account_id, arqueo_date DESC);

CREATE TABLE cash_arqueo_lines (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cash_arqueo_id           UUID NOT NULL REFERENCES cash_arqueos(id) ON DELETE CASCADE,
    currency_id              UUID NOT NULL REFERENCES currencies(id),
    system_balance_snapshot  NUMERIC(20, 8) NOT NULL,
    counted_total            NUMERIC(20, 8) NOT NULL,
    UNIQUE (cash_arqueo_id, currency_id)
);

CREATE INDEX idx_cash_arqueo_lines_arqueo ON cash_arqueo_lines(cash_arqueo_id);

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES
            ('cash_arqueo.view', 'cash_position', 'Ver arqueos de caja', 'Historial y detalle de arqueos; saldo sistema vs conteo.'),
            ('cash_arqueo.create', 'cash_position', 'Registrar arqueo de caja', 'Alta de arqueo con snapshot de saldo sistema por cuenta/divisa.')
        ON CONFLICT (key) DO UPDATE
        SET module = EXCLUDED.module,
            label = EXCLUDED.label,
            description = EXCLUDED.description;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NOT NULL THEN
        INSERT INTO role_permissions (role, permission_key, allowed)
        VALUES
            ('SUPERADMIN', 'cash_arqueo.view', true),
            ('SUPERADMIN', 'cash_arqueo.create', true),
            ('ADMIN', 'cash_arqueo.view', true),
            ('ADMIN', 'cash_arqueo.create', true),
            ('SUBADMIN', 'cash_arqueo.view', true),
            ('SUBADMIN', 'cash_arqueo.create', true),
            ('OPERATOR', 'cash_arqueo.view', true),
            ('OPERATOR', 'cash_arqueo.create', true),
            ('COURIER', 'cash_arqueo.view', false),
            ('COURIER', 'cash_arqueo.create', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
