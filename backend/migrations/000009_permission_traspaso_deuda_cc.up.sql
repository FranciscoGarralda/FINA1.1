BEGIN;

DO $$
BEGIN
    -- Some environments still run with fallback permissions and may not have these tables.
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES ('operations.traspaso_deuda_cc.execute', 'operations', 'Ejecutar traspaso deuda CC', NULL)
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
            ('SUPERADMIN', 'operations.traspaso_deuda_cc.execute', true),
            ('ADMIN', 'operations.traspaso_deuda_cc.execute', true),
            ('SUBADMIN', 'operations.traspaso_deuda_cc.execute', true),
            ('OPERATOR', 'operations.traspaso_deuda_cc.execute', true),
            ('COURIER', 'operations.traspaso_deuda_cc.execute', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
