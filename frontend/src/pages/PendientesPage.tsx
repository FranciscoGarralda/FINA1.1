import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import MoneyInput from '../components/common/MoneyInput';
import { formatMoneyAR } from '../utils/money';

interface PendingItem {
  id: string;
  movement_line_id: string;
  movement_id: string;
  operation_number: number;
  type: string;
  status: string;
  client_id: string;
  client_name: string;
  address_street: string;
  address_number: string;
  address_floor: string;
  phone: string;
  currency_id: string;
  currency_code: string;
  amount: string;
  account_name: string;
  cc_enabled: boolean;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  active: boolean;
}

interface SettingsMap {
  [key: string]: unknown;
}

type ResolveMode = 'REAL_EXECUTION' | 'COMPENSATED';

function pendingTypeLabel(type: string) {
  if (type === 'PENDIENTE_DE_PAGO') return 'Pago';
  if (type === 'PENDIENTE_DE_RETIRO') return 'Retiro';
  if (type === 'PENDIENTE_DE_COBRO_COMISION') return 'Cobro comisión';
  if (type === 'PENDIENTE_DE_PAGO_COMISION') return 'Pago comisión';
  return type;
}

export default function PendientesPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolveTarget, setResolveTarget] = useState<PendingItem | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>('REAL_EXECUTION');
  const [cancelTarget, setCancelTarget] = useState<PendingItem | null>(null);
  const [sortField, setSortField] = useState<'created_at' | 'client_name' | 'amount'>('created_at');
  const [sortAsc, setSortAsc] = useState(true);

  const fetchItems = () => {
    setLoading(true);
    api
      .get<PendingItem[]>('/pendientes')
      .then(setItems)
      .catch(() => setError('Error al cargar pendientes.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const sorted = [...items].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
    else if (sortField === 'client_name') cmp = a.client_name.localeCompare(b.client_name);
    else if (sortField === 'amount') cmp = parseFloat(a.amount) - parseFloat(b.amount);
    return sortAsc ? cmp : -cmp;
  });

  function toggleSort(field: typeof sortField) {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  }

  function formatAddress(item: PendingItem) {
    let addr = item.address_street + ' ' + item.address_number;
    if (item.address_floor) addr += ' ' + item.address_floor;
    return addr;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Pendientes</h2>

      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay pendientes abiertos.</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th
                  className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer select-none"
                  onClick={() => toggleSort('client_name')}
                >
                  Cliente {sortField === 'client_name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Dirección</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Teléfono</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Tipo</th>
                <th
                  className="text-right px-3 py-2 font-medium text-gray-600 cursor-pointer select-none"
                  onClick={() => toggleSort('amount')}
                >
                  Monto {sortField === 'amount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Divisa</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Cuenta orig.</th>
                <th
                  className="text-left px-3 py-2 font-medium text-gray-600 cursor-pointer select-none"
                  onClick={() => toggleSort('created_at')}
                >
                  Fecha {sortField === 'created_at' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Estado</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-3 py-2">{item.client_name}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{formatAddress(item)}</td>
                  <td className="px-3 py-2 text-gray-600">{item.phone}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      item.type === 'PENDIENTE_DE_PAGO'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-orange-50 text-orange-700'
                    }`}>
                      {pendingTypeLabel(item.type)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(item.amount)}</td>
                  <td className="px-3 py-2">{item.currency_code}</td>
                  <td className="px-3 py-2 text-gray-600">{item.account_name}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">
                    {new Date(item.created_at).toLocaleString('es-AR', {
                      day: '2-digit', month: '2-digit', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded font-medium">
                      Abierto
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center space-x-1">
                    <button
                      onClick={() => { setResolveTarget(item); setResolveMode('REAL_EXECUTION'); }}
                      className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 transition"
                    >
                      Resolver
                    </button>
                    {item.cc_enabled && (
                      <button
                        onClick={() => { setResolveTarget(item); setResolveMode('COMPENSATED'); }}
                        className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 transition"
                      >
                        Compensar
                      </button>
                    )}
                    <button
                      onClick={() => setCancelTarget(item)}
                      className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 transition"
                    >
                      Anular op.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resolveTarget && (
        <ResolveModal
          item={resolveTarget}
          initialMode={resolveMode}
          onClose={() => setResolveTarget(null)}
          onDone={() => { setResolveTarget(null); fetchItems(); }}
        />
      )}

      {cancelTarget && (
        <CancelModal
          item={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); fetchItems(); }}
        />
      )}
    </div>
  );
}

function ResolveModal({ item, initialMode, onClose, onDone }: { item: PendingItem; initialMode: ResolveMode; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<SettingsMap>({});
  const [accountId, setAccountId] = useState('');
  const [format, setFormat] = useState('CASH');
  const [amount, setAmount] = useState(item.amount);
  const [mode, setMode] = useState<ResolveMode>(initialMode);
  const [resolvedByMovementId, setResolvedByMovementId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    api.get<Account[]>('/accounts').then((accs) => {
      const active = accs.filter((a) => a.active);
      setAccounts(active);
      if (active.length > 0) setAccountId(active[0].id);
    });
    api.get<SettingsMap>('/settings').then(setSettings).catch(() => {});
  }, []);

  const partialAllowed = settings.pending_allow_partial_resolution !== false;
  const maxAmount = parseFloat(item.amount);
  const isPaymentPending = item.type === 'PENDIENTE_DE_PAGO' || item.type === 'PENDIENTE_DE_PAGO_COMISION';
  const accountLabel = isPaymentPending ? 'Cuenta de salida' : 'Cuenta de ingreso';
  const impactLabel = isPaymentPending
    ? 'Al confirmar, el monto se descontará de la cuenta seleccionada.'
    : 'Al confirmar, el monto ingresará en la cuenta seleccionada.';
  const canCompensate = item.cc_enabled;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }
    if (numAmount > maxAmount) {
      setError('El monto no puede superar el pendiente.');
      return;
    }
    if (!partialAllowed && mode === 'REAL_EXECUTION' && numAmount !== maxAmount) {
      setError('La resolución parcial no está habilitada. Monto debe ser igual al pendiente.');
      return;
    }
    if (mode === 'REAL_EXECUTION' && !accountId) {
      setError('Seleccioná una cuenta destino.');
      return;
    }
    if (mode === 'COMPENSATED') {
      if (!canCompensate) {
        setError('Compensar solo está disponible para clientes con CC.');
        return;
      }
      if (numAmount !== maxAmount) {
        setError('Compensar requiere el monto total pendiente.');
        return;
      }
      if (!resolvedByMovementId.trim()) {
        setError('Ingresá la referencia de la operación que compensa.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.patch(`/pendientes/${item.id}/resolver`, {
        account_id: mode === 'REAL_EXECUTION' ? accountId : '',
        format: mode === 'REAL_EXECUTION' ? format : 'CASH',
        amount: amount,
        mode,
        resolved_by_movement_id: mode === 'COMPENSATED' ? resolvedByMovementId.trim() : '',
        resolution_note: mode === 'COMPENSATED' ? resolutionNote.trim() : '',
      });
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Error al resolver pendiente.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h3 className="text-lg font-semibold text-gray-800 mb-1">Resolver pendiente</h3>
        <p className="text-sm text-gray-500 mb-4">
          {item.client_name} — {item.currency_code} {formatMoneyAR(item.amount)} ({pendingTypeLabel(item.type)})
        </p>
        {mode === 'REAL_EXECUTION' ? (
          <p className="text-xs text-gray-500 mb-4">{impactLabel}</p>
        ) : (
          <p className="text-xs text-gray-500 mb-4">Compensar cierra el pendiente sin mover cuentas reales ni CC.</p>
        )}

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modo</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="mode"
                  value="REAL_EXECUTION"
                  checked={mode === 'REAL_EXECUTION'}
                  onChange={() => setMode('REAL_EXECUTION')}
                />
                Ejecución real
              </label>
              {canCompensate && (
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    value="COMPENSATED"
                    checked={mode === 'COMPENSATED'}
                    onChange={() => setMode('COMPENSATED')}
                  />
                  Compensar
                </label>
              )}
            </div>
          </div>

          {mode === 'REAL_EXECUTION' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{accountLabel}</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-base"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {mode === 'REAL_EXECUTION' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Formato</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="format"
                    value="CASH"
                    checked={format === 'CASH'}
                    onChange={() => setFormat('CASH')}
                  />
                  Efectivo
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="format"
                    value="DIGITAL"
                    checked={format === 'DIGITAL'}
                    onChange={() => setFormat('DIGITAL')}
                  />
                  Digital
                </label>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monto a resolver
              {(!partialAllowed || mode === 'COMPENSATED') && <span className="text-xs text-gray-400 ml-1">(debe ser exacto)</span>}
            </label>
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              disabled={(!partialAllowed && mode === 'REAL_EXECUTION') || mode === 'COMPENSATED'}
            />
          </div>

          {mode === 'COMPENSATED' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Referencia operación que compensa</label>
                <input
                  value={resolvedByMovementId}
                  onChange={(e) => setResolvedByMovementId(e.target.value)}
                  placeholder="ID de movimiento"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Motivo (opcional)</label>
                <input
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Detalle de compensación"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-base"
                />
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-touch text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-touch bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? 'Guardando...' : (mode === 'COMPENSATED' ? 'Confirmar compensación' : 'Confirmar')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function CancelModal({ item, onClose, onDone }: { item: PendingItem; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  async function handleCancel() {
    setSubmitting(true);
    setError('');
    try {
      await api.patch(`/movements/${item.movement_id}/cancel`, {});
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Error al anular operación.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel max-w-sm p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Anular operación</h3>
        <p className="text-sm text-gray-600 mb-4">
          ¿Estás seguro de anular toda la operación? Se revertirán sus efectos reales/comerciales y se cerrarán sus pendientes.
        </p>
        <p className="text-sm text-gray-500 mb-4">
          Operación #{item.operation_number} — {item.client_name} — {item.currency_code} {formatMoneyAR(item.amount)}
        </p>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-touch text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Volver
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="btn-touch bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Anulando...' : 'Confirmar anulación'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
