import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import UserFormModal from '../components/users/UserFormModal';

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

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalUser, setModalUser] = useState<User | null | 'new'>(null);

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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Usuarios</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {canCreate && (
            <button
              onClick={() => setModalUser('new')}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              + Nuevo usuario
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-4 py-3 text-gray-700">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={!canToggleUser(u)}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        u.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      } ${!canToggleUser(u) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {u.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {canEditUser(u) && (
                      <button
                        onClick={() => setModalUser(u)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">Sin resultados</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalUser && (
        <UserFormModal
          user={modalUser === 'new' ? null : modalUser}
          onClose={() => setModalUser(null)}
          onSaved={() => { setModalUser(null); fetchUsers(); }}
        />
      )}
    </div>
  );
}
