BEGIN;

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES (
            'operations.saldo_inicial_caja.execute',
            'operations',
            'Registrar saldo inicial de caja',
            'Alta de movimiento SALDO_INICIAL_CAJA con líneas IN reales (sin CC ni pendientes); auditable y cancelable como el resto.'
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
            ('SUPERADMIN', 'operations.saldo_inicial_caja.execute', true),
            ('ADMIN', 'operations.saldo_inicial_caja.execute', true),
            ('SUBADMIN', 'operations.saldo_inicial_caja.execute', true),
            ('OPERATOR', 'operations.saldo_inicial_caja.execute', false),
            ('COURIER', 'operations.saldo_inicial_caja.execute', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
