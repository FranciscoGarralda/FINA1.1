BEGIN;

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NOT NULL THEN
        DELETE FROM role_permissions
        WHERE permission_key = 'operations.traspaso_deuda_cc.execute';
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.permissions') IS NOT NULL THEN
        DELETE FROM permissions
        WHERE key = 'operations.traspaso_deuda_cc.execute';
    END IF;
END $$;

COMMIT;
