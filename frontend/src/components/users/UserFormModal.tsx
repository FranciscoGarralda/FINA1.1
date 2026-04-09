import { useState, useEffect, FormEvent, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import type { UserPermissionMatrixItem, UserPermissionsResponse } from '../../types/userPermissions';

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
          <div className="border-b border-gray-200 mb-4">
            <nav className="flex gap-5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`min-h-[44px] px-1 pb-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === t.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {availableRoles.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {isEdit && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select
                    value={active ? 'ACTIVE' : 'INACTIVE'}
                    onChange={(e) => setActive(e.target.value === 'ACTIVE')}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contraseña {isEdit && <span className="text-gray-400 font-normal">(dejar vacío para no cambiar)</span>}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={!isEdit}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={!isEdit}
                />
              </div>

              {role === 'COURIER' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">PIN</label>
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="PIN numérico"
                  />
                </div>
              )}
            </>
          )}

          {isEdit && tab === 'permisos' && canViewPermissions && (
            <>
              {permLoading ? (
                <p className="text-sm text-gray-500">Cargando permisos...</p>
              ) : permItems.length === 0 ? (
                <p className="text-sm text-gray-400">No hay permisos para mostrar.</p>
              ) : (
                <div className="space-y-3 max-h-[42vh] overflow-auto pr-1">
                  {permissionModules.map((moduleName) => (
                    <div key={moduleName} className="border border-gray-200 rounded p-3">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2 capitalize">{moduleName}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {groupedPermissions[moduleName].map((item) => (
                          <label key={item.key} className="flex items-center justify-between border border-gray-100 rounded px-2 py-1.5 text-sm">
                            <div className="flex items-center gap-2">
                              <span>{item.label}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                item.source === 'USER'
                                  ? 'bg-blue-100 text-blue-700'
                                  : item.source === 'ROLE'
                                  ? 'bg-gray-100 text-gray-600'
                                  : 'bg-yellow-100 text-yellow-700'
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

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {success && <p className="text-green-600 text-sm">{success}</p>}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between sm:items-center">
            <div className="flex flex-wrap gap-2">
              {isEdit && tab === 'datos' && (
                <button
                  type="button"
                  onClick={handleSaveData}
                  disabled={saving}
                  className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  Guardar cambios
                </button>
              )}
              {isEdit && tab === 'seguridad' && (
                <button
                  type="button"
                  onClick={handleSaveSecurity}
                  disabled={saving}
                  className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  Guardar seguridad
                </button>
              )}
              {isEdit && tab === 'permisos' && canEditPermissions && (
                <button
                  type="button"
                  onClick={handleSavePermissions}
                  disabled={saving || permLoading}
                  className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  Guardar permisos
                </button>
              )}
              {isEdit && tab === 'permisos' && canResetOverrides && (
                <button
                  type="button"
                  onClick={handleResetPermissions}
                  disabled={saving || permLoading}
                  className="btn-touch border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Restaurar permisos al rol
                </button>
              )}
              {!isEdit && (
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-touch border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 w-full sm:w-auto"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
