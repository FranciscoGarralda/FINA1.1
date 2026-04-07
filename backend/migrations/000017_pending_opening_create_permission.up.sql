BEGIN;

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES (
            'pending.opening.create',
            'pending',
            'Registrar pendiente inicial (apertura)',
            'Alta de pendiente de retiro o pago por arrastre operativo; sin impacto CC ni utilidad.'
        )
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
            ('SUPERADMIN', 'pending.opening.create', true),
            ('ADMIN', 'pending.opening.create', true),
            ('SUBADMIN', 'pending.opening.create', true),
            ('OPERATOR', 'pending.opening.create', false),
            ('COURIER', 'pending.opening.create', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
