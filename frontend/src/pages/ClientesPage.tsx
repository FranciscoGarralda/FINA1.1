import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import ClientFormModal from '../components/clients/ClientFormModal';

interface Client {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  phone: string;
  dni: string;
  department?: string;
  active: boolean;
  cc_enabled: boolean;
}

export default function ClientesPage() {
  const { can } = useAuth();
  const canCreate = can('clients.create');
  const canEdit = can('clients.edit');
  const canToggle = can('clients.toggle_active');

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalClient, setModalClient] = useState<Client | null | 'new'>(null);

  const fetchClients = async () => {
    try {
      const data = await api.get<Client[]>('/clients');
      setClients(data);
    } catch {
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const toggleActive = async (c: Client) => {
    try {
      await api.put(`/clients/${c.id}/active`, { active: !c.active });
      setClients((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
    } catch (err: any) {
      alert(err?.message || 'Error al cambiar estado');
    }
  };

  const filtered = clients.filter((c) => {
    const q = search.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const dept = (c.department || '').toLowerCase();
    return (
      fullName.includes(q) ||
      c.dni.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      String(c.client_code).includes(q) ||
      dept.includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Clientes</h2>
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
              onClick={() => setModalClient('new')}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Nº cliente</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium">DNI</th>
                <th className="px-4 py-3 font-medium">Departamento</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium text-center">CC</th>
                {(canEdit || canToggle) && <th className="px-4 py-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 text-gray-500 font-mono">{c.client_code}</td>
                  <td className="px-4 py-3 text-gray-700">{c.first_name} {c.last_name}</td>
                  <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                  <td className="px-4 py-3 text-gray-600">{c.dni}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-[12rem] break-words" title={c.department || undefined}>
                    {c.department?.trim() ? c.department.trim() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={!canToggle}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        c.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {c.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium ${c.cc_enabled ? 'text-blue-600' : 'text-gray-400'}`}>
                      {c.cc_enabled ? 'Sí' : 'No'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalClient(c)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={(canEdit || canToggle) ? 8 : 7} className="px-4 py-6 text-center text-gray-400">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalClient && (
        <ClientFormModal
          client={modalClient === 'new' ? null : modalClient}
          onClose={() => setModalClient(null)}
          onSaved={() => {
            setModalClient(null);
            fetchClients();
          }}
        />
      )}
    </div>
  );
}
