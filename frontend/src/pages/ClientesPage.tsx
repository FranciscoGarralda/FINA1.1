import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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
  address_street: string;
  address_number: string;
  address_floor: string;
  department?: string;
  active: boolean;
  cc_enabled: boolean;
}

type ActiveFilter = 'all' | 'active' | 'inactive';
type CcFilter = 'all' | 'yes' | 'no';

export default function ClientesPage() {
  const { can } = useAuth();
  const canCreate = can('clients.create');
  const canEdit = can('clients.edit');
  const canToggle = can('clients.toggle_active');

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<ActiveFilter>('all');
  const [filterCC, setFilterCC] = useState<CcFilter>('all');
  const [modalClient, setModalClient] = useState<Client | null | 'new'>(null);

  /** Columnas visibles: código, nombre, tel, calle, número, piso, departamento, estado, CC, [acciones]. */
  const tableColCount = 9 + (canEdit ? 1 : 0);

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
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'Error al cambiar estado');
    }
  };

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (filterActive === 'active' && !c.active) return false;
      if (filterActive === 'inactive' && c.active) return false;
      if (filterCC === 'yes' && !c.cc_enabled) return false;
      if (filterCC === 'no' && c.cc_enabled) return false;

      const q = search.trim().toLowerCase();
      if (!q) return true;

      const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
      const dept = (c.department || '').toLowerCase();
      const street = (c.address_street || '').toLowerCase();
      const num = (c.address_number || '').toLowerCase();
      const floor = (c.address_floor || '').toLowerCase();
      return (
        fullName.includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        String(c.client_code).includes(q) ||
        dept.includes(q) ||
        street.includes(q) ||
        num.includes(q) ||
        floor.includes(q)
      );
    });
  }, [clients, search, filterActive, filterCC]);

  const selectClass =
    'border border-subtle rounded-md px-3 py-2 text-sm w-full sm:w-40 min-w-0 bg-app text-fg focus:outline-none focus:border-brand shadow-focus-brand';

  return (
    <div>
      <div className="flex flex-col gap-4 mb-6 min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between min-w-0">
          <h2 className="text-xl font-semibold text-fg shrink-0">Clientes</h2>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto min-w-0 sm:items-center">
            <input
              type="text"
              placeholder="Buscar por nombre, teléfono, domicilio, código…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-subtle rounded-md px-3 py-2 text-sm w-full sm:min-w-[12rem] sm:max-w-xs min-w-0 focus:outline-none focus:border-brand shadow-focus-brand"
            />
            {canCreate && (
              <button
                type="button"
                onClick={() => setModalClient('new')}
                className="bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-hover text-sm font-medium w-full sm:w-auto shrink-0"
              >
                + Nuevo cliente
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row flex-wrap gap-3 sm:items-end">
          <div className="flex flex-col gap-0.5 min-w-0">
            <label htmlFor="clientes-filter-estado" className="text-xs font-medium text-fg-muted">
              Estado
            </label>
            <select
              id="clientes-filter-estado"
              value={filterActive}
              onChange={(e) => setFilterActive(e.target.value as ActiveFilter)}
              className={selectClass}
            >
              <option value="all">Todos</option>
              <option value="active">Solo activos</option>
              <option value="inactive">Solo inactivos</option>
            </select>
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <label htmlFor="clientes-filter-cc" className="text-xs font-medium text-fg-muted">
              CC
            </label>
            <select
              id="clientes-filter-cc"
              value={filterCC}
              onChange={(e) => setFilterCC(e.target.value as CcFilter)}
              className={selectClass}
            >
              <option value="all">Todos</option>
              <option value="yes">Con CC</option>
              <option value="no">Sin CC</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-fg-muted">Cargando...</p>
      ) : (
        <div className="bg-elevated rounded-lg shadow overflow-hidden">
          <div className="table-scroll">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-fg-muted">
                <th className="px-4 py-3 font-medium">Nº cliente</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                <th className="px-4 py-3 font-medium min-w-[7rem]">Calle</th>
                <th className="px-4 py-3 font-medium w-24">Número</th>
                <th className="px-4 py-3 font-medium w-24">Piso</th>
                <th className="px-4 py-3 font-medium">Departamento</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                <th className="px-4 py-3 font-medium text-center">CC</th>
                {canEdit && <th className="px-4 py-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 text-fg-muted font-mono">{c.client_code}</td>
                  <td className="px-4 py-3 text-fg">
                    {c.first_name} {c.last_name}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{c.phone}</td>
                  <td className="px-4 py-3 text-fg max-w-[14rem] break-words" title={c.address_street?.trim() || undefined}>
                    {c.address_street?.trim() ? c.address_street.trim() : '—'}
                  </td>
                  <td className="px-4 py-3 text-fg-muted whitespace-nowrap">{c.address_number?.trim() ? c.address_number.trim() : '—'}</td>
                  <td className="px-4 py-3 text-fg-muted whitespace-nowrap">{c.address_floor?.trim() ? c.address_floor.trim() : '—'}</td>
                  <td className="px-4 py-3 text-fg-muted max-w-[10rem] break-words" title={c.department || undefined}>
                    {c.department?.trim() ? c.department.trim() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
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
                        type="button"
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
                  <td colSpan={tableColCount} className="px-4 py-6 text-center text-fg-subtle">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
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
