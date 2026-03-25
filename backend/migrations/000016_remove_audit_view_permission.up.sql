BEGIN;

DELETE FROM role_permissions WHERE permission_key = 'audit.view';
DELETE FROM permissions WHERE key = 'audit.view';

COMMIT;
