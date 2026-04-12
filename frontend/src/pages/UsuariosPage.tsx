import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import UserFormModal from '../components/users/UserFormModal';
import UserPermissionsModal from '../components/users/UserPermissionsModal';

interface User {
  id: string;
  username: string;
  role: string;
  active: boolean;
}

export default function UsuariosPage() {
  const { role: callerRole, can } = useAuth();
  const canEdit = can('users.edit');
  const canCreate = can('users.create');
  const canToggle = can('users.toggle_active');
  const canViewPermissions = can('permissions.view_user');

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalUser, setModalUser] = useState<User | null | 'new'>(null);
  const [permissionsUser, setPermissionsUser] = useState<User | null>(null);

  const fetchUsers = async () => {
    const data = await api.get<User[]>('/users');
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleActive = async (user: User) => {
    try {
      await api.put(`/users/${user.id}/active`, { active: !user.active });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, active: !u.active } : u)));
    } catch (err: any) {
      alert(err?.message || 'Error al cambiar estado');
    }
  };

  const canEditUser = (u: User) => {
    if (callerRole === 'SUBADMIN' && u.role === 'SUPERADMIN') return false;
    return canEdit;
  };

  const canToggleUser = (u: User) => {
    if (u.role === 'SUPERADMIN') return false;
    return canToggle;
  };

  const filtered = users.filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-fg shrink-0">Usuarios</h2>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto min-w-0">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-subtle rounded-md px-3 py-2 text-sm w-full sm:w-48 min-w-0 focus:outline-none focus:border-brand shadow-focus-brand"
          />
          {canCreate && (
            <button
              onClick={() => setModalUser('new')}
              className="bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-hover text-sm font-medium w-full sm:w-auto shrink-0"
            >
              + Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-fg-muted">Cargando...</p>
      ) : (
        <div className="bg-elevated rounded-lg shadow overflow-hidden">
          <div className="table-scroll">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-fg-muted">
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-3 text-fg">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-surface text-fg-muted px-2 py-0.5 rounded">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={!canToggleUser(u)}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        u.active ? 'bg-success-soft text-success' : 'bg-error-soft text-error'
                      } ${!canToggleUser(u) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {u.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canEditUser(u) && (
                      <button
                        onClick={() => setModalUser(u)}
                        className="text-info hover:text-info text-xs font-medium"
                      >
                        Editar
                      </button>
                    )}
                    {canViewPermissions && u.role !== 'SUPERADMIN' && (
                      <button
                        onClick={() => setPermissionsUser(u)}
                        className="text-brand hover:opacity-80 text-xs font-medium"
                      >
                        Permisos
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-fg-subtle">Sin resultados</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {modalUser && (
        <UserFormModal
          user={modalUser === 'new' ? null : modalUser}
          onClose={() => setModalUser(null)}
          onSaved={() => { setModalUser(null); fetchUsers(); }}
        />
      )}

      {permissionsUser && (
        <UserPermissionsModal
          userId={permissionsUser.id}
          username={permissionsUser.username}
          onClose={() => setPermissionsUser(null)}
        />
      )}
    </div>
  );
}
