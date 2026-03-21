BEGIN;

DELETE FROM role_permissions
WHERE permission_key IN ('permissions.view_user','permissions.edit_user','permissions.reset_user_to_default');

DELETE FROM permissions
WHERE key IN ('permissions.view_user','permissions.edit_user','permissions.reset_user_to_default');

DROP TABLE IF EXISTS user_permissions;

COMMIT;
