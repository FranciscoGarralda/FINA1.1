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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-fg shrink-0">Clientes</h2>
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
              onClick={() => setModalClient('new')}
              className="bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-hover text-sm font-medium w-full sm:w-auto shrink-0"
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-fg-muted">Cargando...</p>
      ) : (
        <div className="bg-elevated rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-fg-muted">
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
                  <td className="px-4 py-3 text-fg-muted font-mono">{c.client_code}</td>
                  <td className="px-4 py-3 text-fg">{c.first_name} {c.last_name}</td>
                  <td className="px-4 py-3 text-fg-muted">{c.phone}</td>
                  <td className="px-4 py-3 text-fg-muted">{c.dni}</td>
                  <td className="px-4 py-3 text-fg-muted max-w-[12rem] break-words" title={c.department || undefined}>
                    {c.department?.trim() ? c.department.trim() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={!canToggle}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        c.active ? 'bg-success-soft text-success' : 'bg-error-soft text-error'
                      } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {c.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium ${c.cc_enabled ? 'text-info' : 'text-fg-subtle'}`}>
                      {c.cc_enabled ? 'Sí' : 'No'}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalClient(c)}
                        className="text-info hover:text-info text-xs font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={(canEdit || canToggle) ? 8 : 7} className="px-4 py-6 text-center text-fg-subtle">
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
