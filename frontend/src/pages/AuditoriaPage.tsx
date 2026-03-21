import { useEffect, useState } from 'react';
import { api } from '../api/client';

interface AuditLogItem {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  user_id: string;
  username: string;
  created_at: string;
}

interface AuditResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  limit: number;
}

interface User { id: string; username: string; }

const ENTITY_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'movement', label: 'Movimiento' },
  { value: 'client', label: 'Cliente' },
  { value: 'account', label: 'Cuenta' },
  { value: 'currency', label: 'Divisa' },
  { value: 'user', label: 'Usuario' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'settings', label: 'Configuración' },
  { value: 'cc_entry', label: 'CC Entry' },
];

const ACTION_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'create', label: 'Crear' },
  { value: 'update', label: 'Editar' },
  { value: 'toggle_active', label: 'Activar/Inactivar' },
  { value: 'resolve', label: 'Resolver' },
  { value: 'resolve_partial', label: 'Resolver parcial' },
  { value: 'cancel', label: 'Cancelar' },
  { value: 'reset_password', label: 'Reset contraseña' },
  { value: 'change_password', label: 'Cambiar contraseña' },
  { value: 'change_pin', label: 'Cambiar PIN' },
  { value: 'compra', label: 'Compra' },
  { value: 'venta', label: 'Venta' },
  { value: 'arbitraje', label: 'Arbitraje' },
  { value: 'transferencia_entre_cuentas', label: 'Transf. entre cuentas' },
  { value: 'ingreso_capital', label: 'Ingreso capital' },
  { value: 'retiro_capital', label: 'Retiro capital' },
  { value: 'gasto', label: 'Gasto' },
  { value: 'pago_cc_cruzado', label: 'Pago CC cruzado' },
  { value: 'update_currencies', label: 'Editar divisas cuenta' },
];

const PAGE_SIZE = 20;

export default function AuditoriaPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<User[]>([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get<User[]>('/users').then((u) => setUsers(u || [])).catch(() => {});
  }, []);

  useEffect(() => { fetchLogs(); }, [page]);

  function fetchLogsPage1() {
    if (page === 1) fetchLogs();
    else setPage(1);
  }

  async function fetchLogs() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (userId) params.set('user_id', userId);
      if (entity) params.set('entity', entity);
      if (action) params.set('action', action);
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));

      const d = await api.get<AuditResponse>(`/audit-logs?${params.toString()}`);
      setData(d);
    } catch {
      setError('Error al cargar auditoría.');
    } finally {
      setLoading(false);
    }
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Auditoría</h2>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Usuario</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Entidad</label>
          <select value={entity} onChange={(e) => setEntity(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            {ENTITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Acción</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={fetchLogsPage1}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition">
          Buscar
        </button>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 bg-gray-50 border-b">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Entidad</th>
              <th className="px-3 py-2">Acción</th>
              <th className="px-3 py-2">ID entidad</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Cargando...</td></tr>
            )}
            {!loading && data && data.items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Sin registros.</td></tr>
            )}
            {!loading && data && data.items.map((item) => (
              <tr key={item.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {new Date(item.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 font-medium">{item.username}</td>
                <td className="px-3 py-2">
                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item.entity_type}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{item.action}</span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-400 font-mono">
                  {item.entity_id ? item.entity_id.slice(0, 8) + '...' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-600">
            Página {page} de {totalPages} ({data.total} registros)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
