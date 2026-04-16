import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ApiErrorBanner from '../components/common/ApiErrorBanner';
import { EmptyState } from '../components/common/EmptyState';
import { SkeletonTable } from '../components/common/Skeleton';
import FormActionsRow from '../components/common/FormActionsRow';
import { movementTypeLabel } from '../utils/movementTypeLabels';
import { formatMoneyAR } from '../utils/money';
import { formatDate } from '../utils/dateFormat';
import { MOVEMENTS_REFRESH_EVENT } from '../constants/appEvents';
import { useAuth } from '../context/AuthContext';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

interface SummaryItem {
  side: string;
  currency_code: string;
  amount: string;
}

interface MovementItem {
  id: string;
  operation_number: number;
  type: string;
  date: string;
  status: string;
  client_name: string | null;
  resumen: string;
  summary_items?: SummaryItem[];
  has_open_pending: boolean;
  created_at: string;
}

interface MovementsResult {
  items: MovementItem[];
  total: number;
  page: number;
  limit: number;
}

type ActionKind = 'modify' | 'recreate' | 'cancel';

interface PendingAction {
  kind: ActionKind;
  movementId: string;
  operationNumber: number;
}

const PAGE_SIZE = 20;

export default function MovimientosPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [data, setData] = useState<MovementsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingModalRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({
    containerRef: pendingModalRef,
    onClose: () => setPendingAction(null),
    active: !!pendingAction,
  });
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [sortDir, setSortDir] = useState('desc');

  useBodyScrollLock(!!pendingAction);

  const fetchData = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (typeFilter) params.set('type', typeFilter);
    if (clientSearch) params.set('client', clientSearch);
    if (sortBy) { params.set('sort_by', sortBy); params.set('sort_dir', sortDir); }

    api
      .get<MovementsResult>(`/movements?${params.toString()}`)
      .then(setData)
      .catch(() => {
        setLoadError('No se pudieron cargar los movimientos. Revisá la conexión e intentá de nuevo.');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [page, dateFrom, dateTo, typeFilter, clientSearch, sortBy, sortDir]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onMovementsRefresh = () => {
      fetchData();
    };
    window.addEventListener(MOVEMENTS_REFRESH_EVENT, onMovementsRefresh);
    return () => window.removeEventListener(MOVEMENTS_REFRESH_EVENT, onMovementsRefresh);
  }, [fetchData]);

  function handleFilterApply() {
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const canStartCorrection = can('operations.create_header', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);
  const canCancelOperation = can('pending.cancel', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER']);

  function displayStatus(status: string) {
    return status === 'CANCELADA' ? 'ANULADA' : status;
  }

  function normalizeStatusForError(status: number | undefined) {
    if (status === 403) return 'No tenés permisos para iniciar esta acción.';
    if (status === 404) return 'La operación no existe o no está disponible.';
    if (status === 409) return 'La operación ya fue actualizada por otro usuario. Refrescá y reintentá.';
    return '';
  }

  function openActionConfirmation(e: React.MouseEvent, movement: MovementItem, kind: ActionKind) {
    e.stopPropagation();
    setPendingAction({ kind, movementId: movement.id, operationNumber: movement.operation_number });
  }

  async function executePendingAction() {
    if (!pendingAction) return;
    setActionError('');
    try {
      if (pendingAction.kind === 'modify') {
        const result = await api.post<{ id: string; operation_number: number }>(`/movements/${pendingAction.movementId}/modify`, {});
        setPendingAction(null);
        navigate('/nueva-operacion', { state: { resumeMovementId: result.id } });
        return;
      }
      if (pendingAction.kind === 'recreate') {
        const result = await api.post<{ id: string; operation_number: number }>(`/movements/${pendingAction.movementId}/recreate`, {});
        setPendingAction(null);
        navigate('/nueva-operacion', { state: { resumeMovementId: result.id } });
        return;
      }
      await api.patch(`/movements/${pendingAction.movementId}/cancel`, {});
      setPendingAction(null);
      fetchData();
    } catch (err: any) {
      const normalized = normalizeStatusForError(err?.status);
      const defaultMessage = pendingAction.kind === 'cancel'
        ? 'No se pudo anular la operación.'
        : pendingAction.kind === 'modify'
          ? 'No se pudo iniciar la corrección.'
          : 'No se pudo recrear la operación.';
      const message = normalized || err?.message || err?.error || err?.code || defaultMessage;
      setActionError(message);
    }
  }

  function actionTitle(kind: ActionKind) {
    if (kind === 'modify') return 'Modificar operación';
    if (kind === 'recreate') return 'Recrear operación';
    return 'Anular operación';
  }

  function actionDescription(kind: ActionKind) {
    if (kind === 'modify') return 'Se creará un nuevo borrador precargado para corregir esta operación.';
    if (kind === 'recreate') return 'Se creará un nuevo borrador precargado a partir de esta operación ANULADA.';
    return 'Se anulará la operación actual y se revertirán sus impactos reales/comerciales.';
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-fg mb-4">Movimientos</h2>
      <ApiErrorBanner message={loadError} />
      {actionError && (
        <div className="mb-3 rounded border border-error/40 bg-error-soft px-3 py-2 text-sm text-error">
          {actionError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end min-w-0">
        <div className="min-w-0 w-full sm:w-auto">
          <label className="block text-xs text-fg-muted mb-0.5">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); }}
            className="w-full min-w-0 max-w-full sm:max-w-none sm:w-auto border border-subtle rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-0 w-full sm:w-auto">
          <label className="block text-xs text-fg-muted mb-0.5">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); }}
            className="w-full min-w-0 max-w-full sm:max-w-none sm:w-auto border border-subtle rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-0 w-full sm:w-auto">
          <label className="block text-xs text-fg-muted mb-0.5">Tipo</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full min-w-0 sm:w-auto border border-subtle rounded px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            <option value="COMPRA">Compra</option>
            <option value="VENTA">Venta</option>
            <option value="ARBITRAJE">Arbitraje</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="TRANSFERENCIA_ENTRE_CUENTAS">Transf. entre cuentas</option>
            <option value="PAGO_CC_CRUZADO">Pago CC cruzado</option>
            <option value="TRASPASO_DEUDA_CC">Traspaso deuda CC</option>
            <option value="GASTO">Gasto</option>
            <option value="INGRESO_CAPITAL">Ingreso capital</option>
            <option value="RETIRO_CAPITAL">Retiro capital</option>
            <option value="PENDIENTE_INICIAL">Pendiente inicial</option>
            <option value="SALDO_INICIAL_CAJA">Saldo inicial caja</option>
          </select>
        </div>
        <div className="min-w-0 w-full sm:w-auto flex-1 sm:flex-none sm:max-w-xs">
          <label className="block text-xs text-fg-muted mb-0.5">Cliente</label>
          <input
            type="text"
            placeholder="Buscar..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="w-full min-w-0 border border-subtle rounded px-2 py-1.5 text-sm sm:w-36"
          />
        </div>
        <div className="min-w-0 w-full sm:w-auto">
          <label className="block text-xs text-fg-muted mb-0.5">Ordenar</label>
          <select
            value={`${sortBy}_${sortDir}`}
            onChange={(e) => {
              const [sb, sd] = e.target.value.split('_');
              setSortBy(sb);
              setSortDir(sd);
            }}
            className="w-full min-w-0 sm:w-auto border border-subtle rounded px-2 py-1.5 text-sm"
          >
            <option value="_desc">Más recientes</option>
            <option value="date_desc">Fecha ↓</option>
            <option value="date_asc">Fecha ↑</option>
            <option value="operation_number_desc">Nº Op. ↓</option>
            <option value="operation_number_asc">Nº Op. ↑</option>
          </select>
        </div>
        <button
          onClick={handleFilterApply}
          className="w-full sm:w-auto px-3 py-1.5 bg-brand text-white text-sm rounded hover:bg-brand-hover transition"
        >
          Filtrar
        </button>
      </div>

      {/* Table */}
      {loading && data === null ? (
        <SkeletonTable rows={8} cols={5} />
      ) : loadError ? null : !data || data.items.length === 0 ? (
        <EmptyState message="No se encontraron movimientos con los filtros actuales." title="Sin resultados" />
      ) : (
        <>
          <div className="bg-elevated border border-subtle rounded-lg table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-surface">
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Nº Op.</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Fecha</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Tipo</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Cliente</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Resumen</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Estado</th>
                  <th className="text-left px-3 py-2 font-medium text-fg-muted">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b last:border-b-0 hover:bg-surface cursor-pointer transition"
                    onClick={() => navigate(`/movimientos/${m.id}`)}
                  >
                    <td className="px-3 py-2 font-mono text-fg">#{m.operation_number}</td>
                    <td className="px-3 py-2 text-fg-muted">{formatDate(m.date)}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs bg-surface text-fg px-1.5 py-0.5 rounded">
                        {movementTypeLabel(m.type)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{m.client_name ?? '(Interno)'}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted font-mono max-w-xs truncate">
                      {m.summary_items && m.summary_items.length > 0 ? (
                        <SummaryDisplay items={m.summary_items} />
                      ) : m.resumen}
                    </td>
                    <td className="px-3 py-2 space-x-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        m.status === 'CANCELADA'
                          ? 'bg-error-soft text-error'
                          : m.status === 'BORRADOR'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-success-soft text-success'
                      }`}>
                        {displayStatus(m.status)}
                      </span>
                      {m.has_open_pending && (
                        <span className="text-xs bg-warning-soft text-warning px-1.5 py-0.5 rounded font-medium">
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <FormActionsRow variant="table">
                        {canStartCorrection && m.status === 'CONFIRMADA' && m.type !== 'PENDIENTE_INICIAL' && (
                          <button
                            type="button"
                            onClick={(e) => openActionConfirmation(e, m, 'modify')}
                            className="w-full min-h-[2rem] shrink-0 px-2 py-1 text-center text-xs text-brand border border-subtle rounded hover:bg-brand-soft transition sm:flex-1 sm:min-w-0"
                          >
                            Modificar
                          </button>
                        )}
                        {canCancelOperation && m.status === 'CONFIRMADA' && (
                          <button
                            type="button"
                            onClick={(e) => openActionConfirmation(e, m, 'cancel')}
                            className="w-full min-h-[2rem] shrink-0 px-2 py-1 text-center text-xs text-error border border-error/30 rounded hover:bg-error-soft transition sm:flex-1 sm:min-w-0"
                          >
                            Anular
                          </button>
                        )}
                        {canStartCorrection && m.status === 'CANCELADA' && m.type !== 'PENDIENTE_INICIAL' && (
                          <button
                            type="button"
                            onClick={(e) => openActionConfirmation(e, m, 'recreate')}
                            className="w-full min-h-[2rem] px-2 py-1 text-center text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 transition"
                          >
                            Recrear desde esta
                          </button>
                        )}
                      </FormActionsRow>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-4 min-w-0">
              <span className="text-sm text-fg-muted break-words">
                Página {data.page} de {totalPages} — {data.total} resultados
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1 text-sm border border-subtle rounded disabled:opacity-40 hover:bg-surface transition"
                >
                  Anterior
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 text-sm border border-subtle rounded disabled:opacity-40 hover:bg-surface transition"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {pendingAction && (
        <div ref={pendingModalRef} className="modal-backdrop">
          <div className="modal-panel modal-enter max-w-md p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <h3 className="mb-2 text-lg font-semibold text-fg">{actionTitle(pendingAction.kind)}</h3>
            <p className="mb-3 text-sm text-fg-muted">
              {actionDescription(pendingAction.kind)}
            </p>
            <p className="mb-4 text-sm text-fg-muted">
              Operación #{pendingAction.operationNumber}
            </p>
            <FormActionsRow
              variant="modal"
              cancel={
                <button
                  type="button"
                  onClick={() => setPendingAction(null)}
                  className="btn-touch text-fg-muted border border-subtle rounded-md hover:bg-surface"
                >
                  Volver
                </button>
              }
              primary={
                <button
                  type="button"
                  onClick={executePendingAction}
                  className={`btn-touch text-white rounded-md ${
                    pendingAction.kind === 'cancel' ? 'bg-error hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
                  }`}
                >
                  Confirmar
                </button>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryDisplay({ items }: { items: SummaryItem[] }) {
  const inItems = items.filter((s) => s.side === 'IN');
  const outItems = items.filter((s) => s.side === 'OUT');

  return (
    <>
      {inItems.length > 0 && (
        <>
          ENTRA:{' '}
          {inItems.map((s, i) => (
            <span key={`in${i}`}>
              {s.currency_code} {formatMoneyAR(s.amount)}
              {i < inItems.length - 1 ? ', ' : ''}
            </span>
          ))}
        </>
      )}
      {inItems.length > 0 && outItems.length > 0 && ' | '}
      {outItems.length > 0 && (
        <>
          SALE:{' '}
          {outItems.map((s, i) => (
            <span key={`out${i}`}>
              {s.currency_code} {formatMoneyAR(s.amount)}
              {i < outItems.length - 1 ? ', ' : ''}
            </span>
          ))}
        </>
      )}
    </>
  );
}
