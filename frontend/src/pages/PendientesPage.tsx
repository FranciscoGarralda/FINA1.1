import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import ClientSearchCombo from '../components/common/ClientSearchCombo';
import ApiErrorBanner from '../components/common/ApiErrorBanner';
import { SkeletonTable } from '../components/common/Skeleton';
import FormActionsRow from '../components/common/FormActionsRow';
import MoneyInput from '../components/common/MoneyInput';
import { useAuth } from '../context/AuthContext';
import { useActiveAccounts } from '../hooks/useActiveAccounts';
import { MOVEMENTS_REFRESH_EVENT } from '../constants/appEvents';
import { allowedFormatsFromList, formatLabel, resolveFormat } from '../utils/accountCurrencyFormats';
import { formatMoneyAR } from '../utils/money';
import { pendingTypeLabel } from '../utils/pendingTypeLabels';

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
  account_id?: string;
  account_name: string;
  /** IN | OUT — línea origen del pendiente (misma al resolver en ejecución real) */
  movement_line_side?: string;
  cc_enabled: boolean;
  created_at: string;
  /** Tipo de movimiento (COMPRA, VENTA, …): para etiquetar pendientes según operación */
  movement_type?: string;
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

/** Misma geometría y transición para las tres acciones de fila (una forma de operar, sin drift de clases).
 *  Móvil: ancho completo y apilado vertical en el contenedor (evita wrap desparejo). Desktop sm+: fila con min-width. */
const PENDING_ROW_ACTION_BASE =
  'inline-flex items-center justify-center w-full min-w-0 h-8 shrink-0 text-xs font-medium text-white rounded-md px-2 transition-colors duration-interaction ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app sm:w-auto sm:min-w-[7.5rem]';
const pendingRowBtnResolver = `${PENDING_ROW_ACTION_BASE} bg-success hover:opacity-90`;
const pendingRowBtnCompensar = `${PENDING_ROW_ACTION_BASE} bg-brand hover:bg-brand-hover`;
const pendingRowBtnAnular = `${PENDING_ROW_ACTION_BASE} bg-error hover:opacity-90`;

interface ClientOption {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  active: boolean;
  cc_enabled: boolean;
}

interface AccountCurrencyRow {
  currency_id: string;
  currency_code: string;
  currency_name: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

export default function PendientesPage() {
  const { can } = useAuth();
  const canOpening = can('pending.opening.create', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingModalOpen, setOpeningModalOpen] = useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-fg">Pendientes</h2>
        {canOpening && (
          <button
            type="button"
            onClick={() => setOpeningModalOpen(true)}
            className="px-3 py-1.5 text-sm bg-brand text-white rounded hover:bg-brand-hover"
          >
            Registrar pendiente inicial
          </button>
        )}
      </div>

      <ApiErrorBanner message={error} />

      {loading && items.length === 0 ? (
        <SkeletonTable rows={6} cols={4} />
      ) : items.length === 0 ? (
        <p className="text-fg-muted text-sm">No hay pendientes abiertos.</p>
      ) : (
        <div className="bg-elevated border border-subtle rounded-lg table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface">
                <th
                  className="text-left px-3 py-2 font-medium text-fg-muted cursor-pointer select-none"
                  onClick={() => toggleSort('client_name')}
                >
                  Cliente {sortField === 'client_name' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Dirección</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Teléfono</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Tipo</th>
                <th
                  className="text-right px-3 py-2 font-medium text-fg-muted cursor-pointer select-none"
                  onClick={() => toggleSort('amount')}
                >
                  Monto {sortField === 'amount' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Divisa</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Cuenta orig.</th>
                <th
                  className="text-left px-3 py-2 font-medium text-fg-muted cursor-pointer select-none"
                  onClick={() => toggleSort('created_at')}
                >
                  Fecha {sortField === 'created_at' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Estado</th>
                <th className="text-center px-3 py-2 font-medium text-fg-muted w-[1%] min-w-0 sm:min-w-[11rem]">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.id} className="border-b last:border-b-0 hover:bg-surface">
                  <td className="px-3 py-2">{item.client_name}</td>
                  <td className="px-3 py-2 text-fg-muted text-xs">{formatAddress(item)}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.phone}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      item.type === 'PENDIENTE_DE_PAGO'
                        ? 'bg-brand-soft text-brand'
                        : 'bg-orange-50 text-orange-700'
                    }`}>
                      {pendingTypeLabel(item.type, item.movement_type)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(item.amount)}</td>
                  <td className="px-3 py-2">{item.currency_code}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.account_name}</td>
                  <td className="px-3 py-2 text-fg-muted text-xs">
                    {new Date(item.created_at).toLocaleString('es-AR', {
                      day: '2-digit', month: '2-digit', year: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs bg-warning-soft text-warning px-2 py-0.5 rounded font-medium">
                      Abierto
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top w-[1%] min-w-0 sm:min-w-[11rem]">
                    <div className="flex min-w-0 w-full flex-col items-stretch gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center">
                      <button
                        type="button"
                        onClick={() => { setResolveTarget(item); setResolveMode('REAL_EXECUTION'); }}
                        className={pendingRowBtnResolver}
                      >
                        Resolver
                      </button>
                      {item.cc_enabled && (
                        <button
                          type="button"
                          onClick={() => { setResolveTarget(item); setResolveMode('COMPENSATED'); }}
                          className={pendingRowBtnCompensar}
                        >
                          Compensar
                        </button>
                      )}
                      <button type="button" onClick={() => setCancelTarget(item)} className={pendingRowBtnAnular}>
                        Anular op.
                      </button>
                    </div>
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
          onDone={() => {
            setResolveTarget(null);
            fetchItems();
          }}
        />
      )}

      {cancelTarget && (
        <CancelModal
          item={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); fetchItems(); }}
        />
      )}

      {openingModalOpen && (
        <OpeningPendingModal
          onClose={() => setOpeningModalOpen(false)}
          onDone={() => { setOpeningModalOpen(false); fetchItems(); }}
        />
      )}
    </div>
  );
}

function OpeningPendingModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const accounts = useActiveAccounts();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [pendingKind, setPendingKind] = useState<'RETIRO' | 'PAGO'>('RETIRO');
  const [accountId, setAccountId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [format, setFormat] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [accountCurrencies, setAccountCurrencies] = useState<AccountCurrencyRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadErr, setLoadErr] = useState('');

  useBodyScrollLock(true);

  useEffect(() => {
    setClientsLoading(true);
    api
      .get<ClientOption[]>('/clients')
      .then((list) => setClients(list.filter((c) => c.active)))
      .catch(() => setLoadErr('No se pudieron cargar clientes.'))
      .finally(() => setClientsLoading(false));
  }, []);

  useEffect(() => {
    if (!accountId) {
      setAccountCurrencies([]);
      return;
    }
    api
      .get<AccountCurrencyRow[]>(`/accounts/${accountId}/currencies`)
      .then(setAccountCurrencies)
      .catch(() => setAccountCurrencies([]));
  }, [accountId]);

  useEffect(() => {
    if (!currencyId) return;
    const allowed = allowedFormatsFromList(accountCurrencies, currencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, format);
    if (next && next !== format) setFormat(next);
  }, [accountCurrencies, currencyId, format]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!clientId || !accountId || !currencyId || !amount.trim()) {
      setError('Completá cliente, cuenta, divisa y monto.');
      return;
    }
    if (parseFloat(amount) <= 0) {
      setError('El monto debe ser mayor a 0.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        client_id: clientId,
        pending_kind: pendingKind,
        account_id: accountId,
        currency_id: currencyId,
        format,
        amount: amount.trim(),
        date: dateStr || undefined,
      };
      const n = note.trim();
      if (n) body.note = n;
      await api.post('/pendientes/apertura', body);
      onDone();
    } catch (err: unknown) {
      const m = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : '';
      setError(m || 'No se pudo registrar el pendiente inicial.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel modal-enter max-w-lg w-full p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-fg mb-1">Pendiente inicial (apertura)</h3>
        <p className="text-xs text-fg-muted mb-4">
          Obligación de caja previa al sistema; sin impacto en cuenta corriente ni utilidad. Misma resolución que el resto de pendientes.
        </p>
        {loadErr && <p className="text-amber-700 text-sm mb-2">{loadErr}</p>}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5" htmlFor="opening-pending-client">
              Cliente
            </label>
            <ClientSearchCombo
              inputId="opening-pending-client"
              className="relative w-full"
              clients={clients}
              value={clientId}
              onChange={setClientId}
              loading={clientsLoading}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Tipo</label>
            <select
              value={pendingKind}
              onChange={(e) => setPendingKind(e.target.value as 'RETIRO' | 'PAGO')}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
            >
              <option value="RETIRO">Salida de caja (OUT)</option>
              <option value="PAGO">Entrada a caja (IN)</option>
            </select>
            <p className="text-xs text-fg-muted mt-1 leading-snug">
              {pendingKind === 'RETIRO'
                ? 'Equivale a entregar o pagar desde caja: al resolver, la línea real es salida (OUT), igual que una entrega en venta.'
                : 'Equivale a cobrar a favor de la casa: al resolver, la línea real es ingreso (IN), igual que un cobro pendiente en venta.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Cuenta</label>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setCurrencyId(''); }}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              required
            >
              <option value="">Elegir…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Divisa</label>
            <select
              value={currencyId}
              onChange={(e) => setCurrencyId(e.target.value)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              required
            >
              <option value="">Elegir…</option>
              {accountCurrencies.map((c) => (
                <option key={c.currency_id} value={c.currency_id}>
                  {c.currency_code} — {c.currency_name}
                </option>
              ))}
            </select>
          </div>
          {currencyId && (
            <div>
              <span className="block text-sm font-medium text-fg mb-1">Formato</span>
              <div className="flex flex-wrap gap-4">
                {allowedFormatsFromList(accountCurrencies, currencyId).map((f) => (
                  <label key={f} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="op-format"
                      value={f}
                      checked={format === f}
                      onChange={() => setFormat(f)}
                    />
                    {formatLabel(f)}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Monto</label>
            <MoneyInput value={amount} onValueChange={setAmount} />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Fecha del movimiento</label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg mb-0.5">Nota (opcional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              placeholder="Ej. arrastre desde sistema anterior"
            />
          </div>
          {error && <p className="text-error text-sm">{error}</p>}
          <FormActionsRow
            variant="modal"
            cancel={
              <button
                type="button"
                onClick={onClose}
                className="btn-touch text-fg-muted border border-subtle rounded-md hover:bg-surface"
              >
                Cancelar
              </button>
            }
            primary={
              <button
                type="submit"
                disabled={submitting}
                className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50"
              >
                {submitting ? 'Guardando…' : 'Registrar'}
              </button>
            }
          />
        </form>
      </div>
    </div>,
    document.body,
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
  const [bootstrapError, setBootstrapError] = useState('');

  useBodyScrollLock(true);

  useEffect(() => {
    let cancelled = false;
    setBootstrapError('');
    const msg = 'No se pudieron cargar cuentas o configuración. Revisá la conexión e intentá de nuevo.';
    api
      .get<Account[]>('/accounts')
      .then((accs) => {
        if (cancelled) return;
        const active = accs.filter((a) => a.active);
        setAccounts(active);
        const preferred =
          item.account_id && active.some((a) => a.id === item.account_id)
            ? item.account_id
            : active[0]?.id ?? '';
        setAccountId(preferred);
      })
      .catch(() => {
        if (!cancelled) setBootstrapError(msg);
      });
    api
      .get<SettingsMap>('/settings')
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch(() => {
        if (!cancelled) setBootstrapError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [item.account_id, item.id]);

  const partialAllowed = settings.pending_allow_partial_resolution !== false;
  const maxAmount = parseFloat(item.amount);
  const side = item.movement_line_side;
  const hasLineSide = side === 'IN' || side === 'OUT';
  const lineIsOut = hasLineSide
    ? side === 'OUT'
    : item.type === 'PENDIENTE_DE_PAGO' || item.type === 'PENDIENTE_DE_PAGO_COMISION';
  const accountLabel = lineIsOut ? 'Cuenta de salida' : 'Cuenta de ingreso';
  const impactLabel = lineIsOut
    ? 'Al confirmar, el monto se descontará de la cuenta de la operación (misma línea que originó el pendiente).'
    : 'Al confirmar, el monto ingresará en la cuenta de la operación (misma línea que originó el pendiente).';
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
      window.dispatchEvent(
        new CustomEvent(MOVEMENTS_REFRESH_EVENT, { detail: { movementId: item.movement_id } }),
      );
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Error al resolver pendiente.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel modal-enter max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h3 className="text-lg font-semibold text-fg mb-1">Resolver pendiente</h3>
        <p className="text-sm text-fg-muted mb-4">
          {item.client_name} — {item.currency_code} {formatMoneyAR(item.amount)} ({pendingTypeLabel(item.type)})
        </p>
        {mode === 'REAL_EXECUTION' ? (
          <p className="text-xs text-fg-muted mb-4">{impactLabel}</p>
        ) : (
          <p className="text-xs text-fg-muted mb-4">Compensar cierra el pendiente sin mover cuentas reales ni CC.</p>
        )}

        <ApiErrorBanner message={bootstrapError} />
        {error && <p className="text-error text-sm mb-3">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Modo</label>
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
              <label className="block text-sm font-medium text-fg mb-1">{accountLabel}</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full border border-subtle rounded px-3 py-2 text-base"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {mode === 'REAL_EXECUTION' && (
            <div>
              <label className="block text-sm font-medium text-fg mb-1">Formato</label>
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
            <label className="block text-sm font-medium text-fg mb-1">
              Monto a resolver
              {(!partialAllowed || mode === 'COMPENSATED') && <span className="text-xs text-fg-subtle ml-1">(debe ser exacto)</span>}
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
                <label className="block text-sm font-medium text-fg mb-1">Referencia operación que compensa</label>
                <input
                  value={resolvedByMovementId}
                  onChange={(e) => setResolvedByMovementId(e.target.value)}
                  placeholder="ID de movimiento"
                  className="w-full border border-subtle rounded px-3 py-2 text-base"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg mb-1">Motivo (opcional)</label>
                <input
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Detalle de compensación"
                  className="w-full border border-subtle rounded px-3 py-2 text-base"
                />
              </div>
            </>
          )}

          <FormActionsRow
            variant="modal"
            cancel={
              <button
                type="button"
                onClick={onClose}
                className="btn-touch text-fg-muted border border-subtle rounded-md hover:bg-surface"
              >
                Cancelar
              </button>
            }
            primary={
              <button
                type="submit"
                disabled={submitting}
                className="btn-touch bg-success text-white rounded-md hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? 'Guardando...' : (mode === 'COMPENSATED' ? 'Confirmar compensación' : 'Confirmar')}
              </button>
            }
          />
        </form>
      </div>
    </div>,
    document.body,
  );
}

function CancelModal({ item, onClose, onDone }: { item: PendingItem; onClose: () => void; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useBodyScrollLock(true);

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
      <div className="modal-panel modal-enter max-w-sm p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h3 className="text-lg font-semibold text-fg mb-2">Anular operación</h3>
        <p className="text-sm text-fg-muted mb-4">
          ¿Estás seguro de anular toda la operación? Se revertirán sus efectos reales/comerciales y se cerrarán sus pendientes.
        </p>
        <p className="text-sm text-fg-muted mb-4">
          Operación #{item.operation_number} — {item.client_name} — {item.currency_code} {formatMoneyAR(item.amount)}
        </p>

        {error && <p className="text-error text-sm mb-3">{error}</p>}

        <FormActionsRow
          variant="modal"
          cancel={
            <button
              type="button"
              onClick={onClose}
              className="btn-touch text-fg-muted border border-subtle rounded-md hover:bg-surface"
            >
              Volver
            </button>
          }
          primary={
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="btn-touch bg-error text-white rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Anulando...' : 'Confirmar anulación'}
            </button>
          }
        />
      </div>
    </div>,
    document.body,
  );
}
