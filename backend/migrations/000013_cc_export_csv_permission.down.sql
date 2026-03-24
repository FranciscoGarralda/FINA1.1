BEGIN;
DELETE FROM role_permissions WHERE permission_key = 'cc.export_csv';
DELETE FROM permissions WHERE key = 'cc.export_csv';
COMMIT;
