import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

interface EntityItem {
  id: string;
  active: boolean;
  [key: string]: any;
}

const ENTITY_SECTIONS = [
  { entityKey: 'users', title: 'Usuarios', endpoint: '/users', displayFn: (e: any) => `${e.username} (${e.role})` },
  { entityKey: 'accounts', title: 'Cuentas', endpoint: '/accounts', displayFn: (e: any) => e.name },
  { entityKey: 'currencies', title: 'Divisas', endpoint: '/currencies', displayFn: (e: any) => `${e.code} — ${e.name}` },
  { entityKey: 'clients', title: 'Clientes', endpoint: '/clients', displayFn: (e: any) => `${e.last_name}, ${e.first_name} (${e.dni})` },
] as const;

export default function EstadosTab() {
  return (
    <div className="space-y-8">
      {ENTITY_SECTIONS.map((section) => (
        <EntitySection key={section.entityKey} {...section} />
      ))}
    </div>
  );
}

function EntitySection({ entityKey, title, endpoint, displayFn }: (typeof ENTITY_SECTIONS)[number]) {
  const { can } = useAuth();
  const [items, setItems] = useState<EntityItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const togglePermissionMap: Record<string, string> = {
    users: 'users.toggle_active',
    accounts: 'accounts.toggle_active',
    currencies: 'currencies.toggle_active',
    clients: 'clients.toggle_active',
  };
  const canToggle = can(togglePermissionMap[entityKey] ?? '');

  useEffect(() => {
    api.get<EntityItem[]>(endpoint).then((data) => {
      setItems(data);
      setLoading(false);
    });
  }, [endpoint]);

  const toggleActive = async (item: EntityItem) => {
    try {
      await api.put(`/${entityKey}/${item.id}/active`, { active: !item.active });
      setItems((prev) => prev.map((e) => (e.id === item.id ? { ...e, active: !e.active } : e)));
    } catch (err: any) {
      alert(err?.message || 'Error al cambiar estado');
    }
  };

  const filtered = items.filter((item) => {
    const text = displayFn(item).toLowerCase();
    return text.includes(search.toLowerCase());
  });

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-gray-800">{title}</h3>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm">Sin resultados</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 font-medium">Nombre / Identificador</th>
              <th className="pb-2 font-medium text-center w-32">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b last:border-0">
                <td className="py-2 text-gray-700">{displayFn(item)}</td>
                <td className="py-2 text-center">
                  <button
                    onClick={() => toggleActive(item)}
                    disabled={!canToggle}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      item.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                  >
                    {item.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
