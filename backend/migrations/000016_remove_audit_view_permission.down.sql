BEGIN;

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES ('audit.view', 'audit', 'Ver auditoría', NULL)
        ON CONFLICT (key) DO NOTHING;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NOT NULL THEN
        INSERT INTO role_permissions (role, permission_key, allowed)
        VALUES
            ('SUPERADMIN', 'audit.view', true),
            ('ADMIN', 'audit.view', true),
            ('SUBADMIN', 'audit.view', true),
            ('OPERATOR', 'audit.view', false),
            ('COURIER', 'audit.view', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
