BEGIN;

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        INSERT INTO permissions (key, module, label, description)
        VALUES ('cc.export_csv', 'cc', 'Exportar CSV de movimientos CC (compartir)', 'Histórico de asientos CC por cliente y rango; sin líneas de detalle de operación.')
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
            ('SUPERADMIN', 'cc.export_csv', true),
            ('ADMIN', 'cc.export_csv', true),
            ('SUBADMIN', 'cc.export_csv', true),
            ('OPERATOR', 'cc.export_csv', true),
            ('COURIER', 'cc.export_csv', false)
        ON CONFLICT (role, permission_key) DO UPDATE
        SET allowed = EXCLUDED.allowed,
            updated_at = now();
    END IF;
END $$;

COMMIT;
