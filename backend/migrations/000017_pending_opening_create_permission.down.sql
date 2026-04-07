BEGIN;

DELETE FROM role_permissions WHERE permission_key = 'pending.opening.create';
DELETE FROM permissions WHERE key = 'pending.opening.create';

COMMIT;
