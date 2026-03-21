BEGIN;

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_key VARCHAR NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    allowed        BOOLEAN NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     UUID NULL REFERENCES users(id),
    PRIMARY KEY (user_id, permission_key)
);

-- Ensure user-specific permission management keys exist.
INSERT INTO permissions (key, module, label, description) VALUES
('permissions.view_user', 'users', 'Ver permisos de usuario', NULL),
('permissions.edit_user', 'users', 'Editar permisos de usuario', NULL),
('permissions.reset_user_to_default', 'users', 'Restaurar permisos al rol', NULL)
ON CONFLICT (key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- Make sure role_permissions has rows for these keys.
INSERT INTO role_permissions (role, permission_key, allowed)
SELECT r.role, p.key, false
FROM (VALUES ('SUPERADMIN'),('ADMIN'),('SUBADMIN'),('OPERATOR'),('COURIER')) AS r(role)
JOIN permissions p ON p.key IN ('permissions.view_user','permissions.edit_user','permissions.reset_user_to_default')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Default: only SUPERADMIN can manage user permissions (non-breaking conservative policy).
UPDATE role_permissions
SET allowed = true, updated_at = now()
WHERE role = 'SUPERADMIN'
  AND permission_key IN ('permissions.view_user','permissions.edit_user','permissions.reset_user_to_default');

COMMIT;
