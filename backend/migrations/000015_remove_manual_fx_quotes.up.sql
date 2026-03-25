BEGIN;

DROP TABLE IF EXISTS manual_fx_quotes;

DELETE FROM role_permissions WHERE permission_key IN ('manual_fx_quotes.view', 'manual_fx_quotes.edit');
DELETE FROM permissions WHERE key IN ('manual_fx_quotes.view', 'manual_fx_quotes.edit');

COMMIT;
