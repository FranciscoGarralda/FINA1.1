import { useState, useEffect, FormEvent, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import type { UserPermissionMatrixItem, UserPermissionsResponse } from '../../types/userPermissions';
import FormActionsRow from '../common/FormActionsRow';

const ROLES = ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER'];

interface User {
  id: string;
  username: string;
  role: string;
  active: boolean;
}

interface Props {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserFormModal({ user, onClose, onSaved }: Props) {
  const { role: callerRole, can } = useAuth();
  const isEdit = !!user;

  const [username, setUsername] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'datos' | 'seguridad' | 'permisos'>('datos');
  const [permItems, setPermItems] = useState<UserPermissionMatrixItem[]>([]);
  const [permLoading, setPermLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setRole(user.role);
      setActive(user.active);
    } else {
      setActive(true);
    }
  }, [user]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const availableRoles = callerRole === 'SUBADMIN' ? ROLES.filter((r) => r !== 'SUPERADMIN') : ROLES;
  const canResetPassword = can('users.reset_password');
  const canViewPermissions = isEdit && can('permissions.view_user');
  const canEditPermissions = isEdit && can('permissions.edit_user');
  const canResetOverrides = isEdit && can('permissions.reset_user_to_default');
  const tabs = useMemo(() => {
    const base: Array<{ key: 'datos' | 'seguridad' | 'permisos'; label: string }> = [
      { key: 'datos', label: 'Datos' },
      { key: 'seguridad', label: 'Seguridad' },
    ];
    if (canViewPermissions) base.push({ key: 'permisos', label: 'Permisos' });
    return base;
  }, [canViewPermissions]);

  const loadPermissions = useCallback(async () => {
    if (!user) return;
    setPermLoading(true);
    try {
      const data = await api.get<UserPermissionsResponse>(`/users/${user.id}/permissions`);
      setPermItems(data.items ?? []);
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar los permisos.');
    } finally {
      setPermLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (tab !== 'permisos' || !isEdit || !canViewPermissions) return;
    void loadPermissions();
  }, [tab, isEdit, canViewPermissions, loadPermissions]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (isEdit) return;
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      if (!password) {
        setError('La contraseña es obligatoria.');
        return;
      }
      if (!confirmPassword) {
        setError('La confirmación de contraseña es obligatoria.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden.');
        return;
      }
      if (role === 'COURIER' && !pin) {
        setError('El PIN es obligatorio para COURIER.');
        return;
      }

      await api.post('/users', {
        username,
        role,
        password,
        pin: role === 'COURIER' ? pin : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Error al guardar usuario.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveData = async () => {
    if (!isEdit || !user) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.put(`/users/${user.id}`, { username, role });
      if (active !== user.active) {
        await api.put(`/users/${user.id}/active`, { active });
      }
      setSuccess('Datos guardados.');
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'No se pudieron guardar los datos.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSecurity = async () => {
    if (!isEdit || !user) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      if (password) {
        if (!canResetPassword) {
          setError('No tenés permisos para resetear contraseña.');
          return;
        }
        if (!confirmPassword) {
          setError('La confirmación de contraseña es obligatoria.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Las contraseñas no coinciden.');
          return;
        }
        await api.put(`/users/${user.id}/reset-password`, { password });
      }

      if (role === 'COURIER' && pin) {
        await api.put(`/users/${user.id}`, { username, role, pin });
      }
      setSuccess('Seguridad guardada.');
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar seguridad.');
    } finally {
      setSaving(false);
    }
  };

  const groupedPermissions = useMemo(() => {
    const m: Record<string, typeof permItems> = {};
    for (const item of permItems) {
      if (!m[item.module]) m[item.module] = [];
      m[item.module].push(item);
    }
    return m;
  }, [permItems]);

  const permissionModules = useMemo(() => Object.keys(groupedPermissions).sort(), [groupedPermissions]);

  const togglePermission = (key: string) => {
    setPermItems((prev) => prev.map((i) => i.key === key ? { ...i, allowed: !i.allowed } : i));
  };

  const handleSavePermissions = async () => {
    if (!isEdit || !user) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.put(`/users/${user.id}/permissions`, {
        items: permItems.map((i) => ({ key: i.key, allowed: i.allowed })),
      });
      setSuccess('Permisos guardados.');
      await loadPermissions();
    } catch (err: any) {
      setError(err?.message || 'No se pudieron guardar los permisos.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPermissions = async () => {
    if (!isEdit || !user) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.delete(`/users/${user.id}/permissions/overrides`);
      setSuccess('Permisos restaurados al rol.');
      await loadPermissions();
    } catch (err: any) {
      setError(err?.message || 'No se pudieron restaurar los permisos.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel max-w-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
        {isEdit && (
          <div className="border-b border-subtle mb-4">
            <nav className="flex gap-5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`min-h-[44px] px-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.key
                      ? 'border-brand text-info'
                      : 'border-transparent text-fg-muted hover:text-fg'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4">
          {(!isEdit || tab === 'datos') && (
            <>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Usuario</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg mb-1">Rol</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {isEdit && (
                <div>
                  <label className="block text-sm font-medium text-fg mb-1">Estado</label>
                  <select
                    value={active ? 'ACTIVE' : 'INACTIVE'}
                    onChange={(e) => setActive(e.target.value === 'ACTIVE')}
                    className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                  >
                    <option value="ACTIVE">Activo</option>
                    <option value="INACTIVE">Inactivo</option>
                  </select>
                </div>
              )}
            </>
          )}

          {(!isEdit || tab === 'seguridad') && (
            <>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">
                  Contraseña {isEdit && <span className="text-fg-subtle font-normal">(dejar vacío para no cambiar)</span>}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                  required={!isEdit}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-fg mb-1">Confirmar contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                  required={!isEdit}
                />
              </div>

              {role === 'COURIER' && (
                <div>
                  <label className="block text-sm font-medium text-fg mb-1">PIN</label>
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
                    placeholder="PIN numérico"
                  />
                </div>
              )}
            </>
          )}

          {isEdit && tab === 'permisos' && canViewPermissions && (
            <>
              {permLoading ? (
                <p className="text-sm text-fg-muted">Cargando permisos...</p>
              ) : permItems.length === 0 ? (
                <p className="text-sm text-fg-subtle">No hay permisos para mostrar.</p>
              ) : (
                <div className="space-y-3 max-h-[42vh] overflow-auto pr-1">
                  {permissionModules.map((moduleName) => (
                    <div key={moduleName} className="border border-subtle rounded p-3">
                      <h4 className="text-sm font-semibold text-fg mb-2 capitalize">{moduleName}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {groupedPermissions[moduleName].map((item) => (
                          <label key={item.key} className="flex items-center justify-between border border-subtle rounded px-2 py-1.5 text-sm">
                            <div className="flex items-center gap-2">
                              <span>{item.label}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                item.source === 'USER'
                                  ? 'bg-brand-soft text-brand'
                                  : item.source === 'ROLE'
                                  ? 'bg-surface text-fg-muted'
                                  : 'bg-warning-soft text-warning'
                              }`}>
                                {item.source === 'USER' ? 'Usuario' : item.source === 'ROLE' ? 'Rol' : 'Fallback'}
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              checked={item.allowed}
                              onChange={() => togglePermission(item.key)}
                              disabled={!canEditPermissions}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <p className="text-error text-sm">{error}</p>}
          {success && <p className="text-success text-sm">{success}</p>}

          <FormActionsRow
            variant="modal"
            primary={
              !isEdit ? (
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50 font-medium"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              ) : tab === 'datos' ? (
                <button
                  type="button"
                  onClick={handleSaveData}
                  disabled={saving}
                  className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50 font-medium"
                >
                  Guardar cambios
                </button>
              ) : tab === 'seguridad' ? (
                <button
                  type="button"
                  onClick={handleSaveSecurity}
                  disabled={saving}
                  className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50 font-medium"
                >
                  Guardar seguridad
                </button>
              ) : tab === 'permisos' && canEditPermissions ? (
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={saving || permLoading}
                  className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50 font-medium"
                >
                  Guardar permisos
                </button>
              ) : null
            }
            secondary={
              isEdit && tab === 'permisos' && canResetOverrides ? (
                <button
                  type="button"
                  onClick={handleResetPermissions}
                  disabled={saving || permLoading}
                  className="btn-touch border border-subtle text-fg rounded-md hover:bg-surface disabled:opacity-50"
                >
                  Restaurar permisos al rol
                </button>
              ) : null
            }
            cancel={
              <button
                type="button"
                onClick={onClose}
                className="btn-touch border border-subtle text-fg rounded-md hover:bg-surface"
              >
                Cancelar
              </button>
            }
          />
        </form>
      </div>
    </div>,
    document.body
  );
}
