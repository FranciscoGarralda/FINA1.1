BEGIN;

DROP TABLE IF EXISTS cash_arqueo_lines;
DROP TABLE IF EXISTS cash_arqueos;

DELETE FROM role_permissions WHERE permission_key IN ('cash_arqueo.view', 'cash_arqueo.create');
DELETE FROM permissions WHERE key IN ('cash_arqueo.view', 'cash_arqueo.create');

COMMIT;
