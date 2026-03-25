BEGIN;

CREATE TABLE IF NOT EXISTS manual_fx_quotes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency_id UUID NOT NULL REFERENCES currencies(id),
    to_currency_id   UUID NOT NULL REFERENCES currencies(id),
    rate             NUMERIC(20,8) NOT NULL CHECK (rate > 0),
    active           BOOLEAN NOT NULL DEFAULT true,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       UUID NULL REFERENCES users(id),
    UNIQUE(from_currency_id, to_currency_id)
);

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES
            ('manual_fx_quotes.view', 'reportes', 'Ver cotizaciones manuales', NULL),
            ('manual_fx_quotes.edit', 'reportes', 'Editar cotizaciones manuales', NULL)
        ON CONFLICT (key) DO NOTHING;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NOT NULL THEN
        INSERT INTO role_permissions (role, permission_key, allowed)
        VALUES
            ('SUPERADMIN', 'manual_fx_quotes.view', true),
            ('SUPERADMIN', 'manual_fx_quotes.edit', true),
            ('ADMIN', 'manual_fx_quotes.view', true),
            ('ADMIN', 'manual_fx_quotes.edit', true),
            ('SUBADMIN', 'manual_fx_quotes.view', true),
            ('SUBADMIN', 'manual_fx_quotes.edit', true),
            ('OPERATOR', 'manual_fx_quotes.view', false),
            ('OPERATOR', 'manual_fx_quotes.edit', false),
            ('COURIER', 'manual_fx_quotes.view', false),
            ('COURIER', 'manual_fx_quotes.edit', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
