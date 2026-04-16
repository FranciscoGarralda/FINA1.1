import { useEffect, useState } from 'react';
import { toast } from 'sonner';
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
      toast.error(err?.message || 'Error al cambiar estado');
    }
  };

  const filtered = items.filter((item) => {
    const text = displayFn(item).toLowerCase();
    return text.includes(search.toLowerCase());
  });

  return (
    <div className="bg-elevated rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-fg">{title}</h3>
        <input
          type="text"
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-subtle rounded-md px-3 py-1 text-sm w-48 focus:outline-none focus:border-brand shadow-focus-brand"
        />
      </div>

      {loading ? (
        <p className="text-fg-muted text-sm">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-fg-subtle text-sm">Sin resultados</p>
      ) : (
        <div className="table-scroll">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b text-left text-fg-muted">
              <th className="pb-2 font-medium">Nombre / Identificador</th>
              <th className="pb-2 font-medium text-center w-32">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b last:border-0">
                <td className="py-2 text-fg">{displayFn(item)}</td>
                <td className="py-2 text-center">
                  <button
                    onClick={() => toggleActive(item)}
                    disabled={!canToggle}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      item.active
                        ? 'bg-success-soft text-success'
                        : 'bg-error-soft text-error'
                    } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                  >
                    {item.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
