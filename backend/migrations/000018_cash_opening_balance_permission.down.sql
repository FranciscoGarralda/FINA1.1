BEGIN;

DELETE FROM role_permissions WHERE permission_key = 'operations.saldo_inicial_caja.execute';
DELETE FROM permissions WHERE key = 'operations.saldo_inicial_caja.execute';

COMMIT;
