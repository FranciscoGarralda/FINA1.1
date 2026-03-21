BEGIN;

CREATE TABLE IF NOT EXISTS permissions (
    key         VARCHAR PRIMARY KEY,
    module      VARCHAR NOT NULL,
    label       VARCHAR NOT NULL,
    description VARCHAR NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role           VARCHAR NOT NULL CHECK (role IN ('SUPERADMIN','ADMIN','SUBADMIN','OPERATOR','COURIER')),
    permission_key VARCHAR NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    allowed        BOOLEAN NOT NULL DEFAULT true,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     UUID NULL REFERENCES users(id),
    PRIMARY KEY (role, permission_key)
);

INSERT INTO permissions (key, module, label, description) VALUES
('dashboard.view', 'dashboard', 'Ver inicio', NULL),
('settings.view', 'settings', 'Ver configuración', NULL),
('settings.edit', 'settings', 'Editar configuración', NULL),
('users.view', 'users', 'Ver usuarios', NULL),
('users.create', 'users', 'Crear usuarios', NULL),
('users.edit', 'users', 'Editar usuarios', NULL),
('users.toggle_active', 'users', 'Activar/Inactivar usuarios', NULL),
('users.reset_password', 'users', 'Resetear contraseña de usuarios', NULL),
('currencies.view', 'currencies', 'Ver divisas', NULL),
('currencies.create', 'currencies', 'Crear divisas', NULL),
('currencies.edit', 'currencies', 'Editar divisas', NULL),
('currencies.toggle_active', 'currencies', 'Activar/Inactivar divisas', NULL),
('accounts.view', 'accounts', 'Ver cuentas', NULL),
('accounts.create', 'accounts', 'Crear cuentas', NULL),
('accounts.edit', 'accounts', 'Editar cuentas', NULL),
('accounts.toggle_active', 'accounts', 'Activar/Inactivar cuentas', NULL),
('accounts.currencies.edit', 'accounts', 'Editar divisas por cuenta', NULL),
('clients.view', 'clients', 'Ver clientes', NULL),
('clients.create', 'clients', 'Crear clientes', NULL),
('clients.edit', 'clients', 'Editar clientes', NULL),
('clients.toggle_active', 'clients', 'Activar/Inactivar clientes', NULL),
('cc.view', 'cc', 'Ver posiciones CC', NULL),
('movements.view', 'movements', 'Ver movimientos', NULL),
('movements.detail.view', 'movements', 'Ver detalle de movimiento', NULL),
('operations.create_header', 'operations', 'Crear encabezado de operación', NULL),
('operations.compra.execute', 'operations', 'Ejecutar compra', NULL),
('operations.venta.execute', 'operations', 'Ejecutar venta', NULL),
('operations.arbitraje.execute', 'operations', 'Ejecutar arbitraje', NULL),
('operations.transferencia_entre_cuentas.execute', 'operations', 'Ejecutar transferencia entre cuentas', NULL),
('operations.transferencia.execute', 'operations', 'Ejecutar transferencia', NULL),
('operations.ingreso_capital.execute', 'operations', 'Ejecutar ingreso de capital', NULL),
('operations.retiro_capital.execute', 'operations', 'Ejecutar retiro de capital', NULL),
('operations.gasto.execute', 'operations', 'Ejecutar gasto', NULL),
('operations.pago_cc_cruzado.execute', 'operations', 'Ejecutar pago CC cruzado', NULL),
('pending.view', 'pending', 'Ver pendientes', NULL),
('pending.resolve', 'pending', 'Resolver pendientes', NULL),
('pending.cancel', 'pending', 'Cancelar pendientes', NULL),
('reportes.view', 'reportes', 'Ver reportes', NULL),
('manual_fx_quotes.view', 'reportes', 'Ver cotizaciones manuales', NULL),
('manual_fx_quotes.edit', 'reportes', 'Editar cotizaciones manuales', NULL),
('audit.view', 'audit', 'Ver auditoría', NULL),
('profile.view', 'profile', 'Ver perfil', NULL),
('profile.change_password', 'profile', 'Cambiar contraseña propia', NULL),
('profile.change_pin', 'profile', 'Cambiar PIN propio', NULL),
('cash_position.view', 'cash_position', 'Ver posición de caja', NULL)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO role_permissions (role, permission_key, allowed)
SELECT r.role, p.key, false
FROM (VALUES ('SUPERADMIN'),('ADMIN'),('SUBADMIN'),('OPERATOR'),('COURIER')) AS r(role)
CROSS JOIN permissions p
ON CONFLICT (role, permission_key) DO UPDATE
SET allowed = EXCLUDED.allowed,
    updated_at = now();

UPDATE role_permissions SET allowed = true WHERE role = 'SUPERADMIN';

UPDATE role_permissions
SET allowed = true
WHERE role = 'ADMIN'
  AND permission_key IN (
    'dashboard.view','settings.view','users.view',
    'currencies.view','currencies.create','currencies.edit','currencies.toggle_active',
    'accounts.view','accounts.create','accounts.edit','accounts.toggle_active','accounts.currencies.edit',
    'clients.view','clients.create','clients.edit','clients.toggle_active',
    'cc.view',
    'movements.view','movements.detail.view',
    'operations.create_header','operations.compra.execute','operations.venta.execute','operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute','operations.transferencia.execute',
    'operations.ingreso_capital.execute','operations.retiro_capital.execute','operations.gasto.execute',
    'operations.pago_cc_cruzado.execute',
    'pending.view','pending.resolve','pending.cancel',
    'reportes.view','manual_fx_quotes.view','manual_fx_quotes.edit',
    'audit.view',
    'profile.view','profile.change_password',
    'cash_position.view'
  );

UPDATE role_permissions
SET allowed = true
WHERE role = 'SUBADMIN'
  AND permission_key IN (
    'dashboard.view','settings.view',
    'users.view','users.create','users.edit','users.reset_password',
    'currencies.view','currencies.create','currencies.edit','currencies.toggle_active',
    'accounts.view','accounts.create','accounts.edit','accounts.toggle_active','accounts.currencies.edit',
    'clients.view','clients.create','clients.edit','clients.toggle_active',
    'cc.view',
    'movements.view','movements.detail.view',
    'operations.create_header','operations.compra.execute','operations.venta.execute','operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute','operations.transferencia.execute',
    'operations.ingreso_capital.execute','operations.retiro_capital.execute','operations.gasto.execute',
    'operations.pago_cc_cruzado.execute',
    'pending.view','pending.resolve','pending.cancel',
    'reportes.view','manual_fx_quotes.view','manual_fx_quotes.edit',
    'audit.view',
    'profile.view','profile.change_password',
    'cash_position.view'
  );

UPDATE role_permissions
SET allowed = true
WHERE role = 'OPERATOR'
  AND permission_key IN (
    'dashboard.view',
    'currencies.view','accounts.view',
    'clients.view','clients.create','clients.edit','clients.toggle_active',
    'cc.view',
    'movements.view','movements.detail.view',
    'operations.create_header','operations.compra.execute','operations.venta.execute','operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute','operations.transferencia.execute',
    'operations.ingreso_capital.execute','operations.retiro_capital.execute','operations.gasto.execute',
    'operations.pago_cc_cruzado.execute',
    'pending.view','pending.resolve','pending.cancel',
    'profile.view','profile.change_password',
    'cash_position.view'
  );

UPDATE role_permissions
SET allowed = true
WHERE role = 'COURIER'
  AND permission_key IN (
    'dashboard.view',
    'clients.view',
    'pending.view','pending.resolve','pending.cancel',
    'profile.view','profile.change_password','profile.change_pin'
  );

COMMIT;
