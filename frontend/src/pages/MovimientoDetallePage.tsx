import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { MOVEMENTS_REFRESH_EVENT, type MovementsRefreshDetail } from '../constants/appEvents';
import { movementTypeLabel } from '../utils/movementTypeLabels';
import { formatMoneyAR } from '../utils/money';
import { useAuth } from '../context/AuthContext';
import FormActionsRow from '../components/common/FormActionsRow';

interface MovementLine {
  id: string;
  side: string;
  account_name: string;
  currency_code: string;
  format: string;
  amount: string;
  is_pending: boolean;
  pending_status: string | null;
}

interface MovementDetail {
  id: string;
  operation_number: number;
  type: string;
  date: string;
  day_name: string;
  status: string;
  client_name: string | null;
  note: string | null;
  created_at: string;
  lines: MovementLine[];
}

type DetailActionKind = 'modify' | 'recreate' | 'cancel';

export default function MovimientoDetallePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<DetailActionKind | null>(null);

  const loadDetail = useCallback(() => {
    if (!id) return;
    setError('');
    setLoading(true);
    api
      .get<MovementDetail>(`/movements/${id}`)
      .then(setDetail)
      .catch(() => setError('No se pudo cargar el movimiento.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const onMovementsRefresh = (ev: Event) => {
      const mid = (ev as CustomEvent<MovementsRefreshDetail>).detail?.movementId;
      if (!id) return;
      if (mid == null || mid === id) {
        loadDetail();
      }
    };
    window.addEventListener(MOVEMENTS_REFRESH_EVENT, onMovementsRefresh);
    return () => window.removeEventListener(MOVEMENTS_REFRESH_EVENT, onMovementsRefresh);
  }, [id, loadDetail]);

  if (loading) return <p className="text-fg-muted text-sm p-4">Cargando...</p>;
  if (error || !detail) return <p className="text-error text-sm p-4">{error || 'No encontrado.'}</p>;
  const canStartCorrection = can('operations.create_header', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);
  const canCancelOperation = can('pending.cancel', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER']);

  const inLines = detail.lines.filter((l) => l.side === 'IN');
  const outLines = detail.lines.filter((l) => l.side === 'OUT');
  const createdTime = new Date(detail.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  function formatLabel(f: string) {
    return f === 'CASH' ? 'Efectivo' : 'Digital';
  }

  function pendingLabel(line: MovementLine) {
    if (!line.is_pending) return 'No';
    if (line.pending_status === 'RESUELTO') return 'Resuelto';
    if (line.pending_status === 'CANCELADO') return 'Cancelado';
    return 'Sí (Abierto)';
  }

  function pendingColor(line: MovementLine) {
    if (!line.is_pending) return 'text-fg-muted';
    if (line.pending_status === 'RESUELTO') return 'text-success';
    if (line.pending_status === 'CANCELADO') return 'text-error';
    return 'text-warning';
  }

  function renderLinesTable(lines: MovementLine[], title: string) {
    if (lines.length === 0) return null;
    return (
      <div className="mb-6">
        <h4 className="text-sm font-medium text-fg-muted mb-2">{title}</h4>
        <div className="bg-elevated border border-subtle rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-surface">
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Cuenta</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Divisa</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Formato</th>
                <th className="text-right px-3 py-2 font-medium text-fg-muted">Monto</th>
                <th className="text-left px-3 py-2 font-medium text-fg-muted">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{l.account_name}</td>
                  <td className="px-3 py-2">{l.currency_code}</td>
                  <td className="px-3 py-2">{formatLabel(l.format)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(l.amount)}</td>
                  <td className={`px-3 py-2 text-xs font-medium ${pendingColor(l)}`}>
                    {pendingLabel(l)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function displayStatus(status: string) {
    return status === 'CANCELADA' ? 'ANULADA' : status;
  }

  function normalizeStatusForError(status: number | undefined) {
    if (status === 403) return 'No tenés permisos para iniciar esta acción.';
    if (status === 404) return 'La operación no existe o no está disponible.';
    if (status === 409) return 'La operación ya fue actualizada por otro usuario. Refrescá y reintentá.';
    return '';
  }

  async function executePendingAction() {
    if (!detail) return;
    try {
      if (pendingAction === 'modify') {
        const result = await api.post<{ id: string }>(`/movements/${detail.id}/modify`, {});
        setPendingAction(null);
        navigate('/nueva-operacion', { state: { resumeMovementId: result.id } });
        return;
      }
      if (pendingAction === 'recreate') {
        const result = await api.post<{ id: string }>(`/movements/${detail.id}/recreate`, {});
        setPendingAction(null);
        navigate('/nueva-operacion', { state: { resumeMovementId: result.id } });
        return;
      }
      await api.patch(`/movements/${detail.id}/cancel`, {});
      setPendingAction(null);
      loadDetail();
    } catch (err: any) {
      const normalized = normalizeStatusForError(err?.status);
      const defaultMessage = pendingAction === 'cancel'
        ? 'No se pudo anular la operación.'
        : pendingAction === 'modify'
          ? 'No se pudo iniciar la corrección.'
          : 'No se pudo recrear la operación.';
      setError(normalized || err?.message || defaultMessage);
    }
  }

  function actionTitle(kind: DetailActionKind) {
    if (kind === 'modify') return 'Modificar operación';
    if (kind === 'recreate') return 'Recrear operación';
    return 'Anular operación';
  }

  function actionDescription(kind: DetailActionKind) {
    if (kind === 'modify') return 'Se creará un nuevo borrador precargado para corregir esta operación.';
    if (kind === 'recreate') return 'Se creará un nuevo borrador precargado a partir de esta operación ANULADA.';
    return 'Se anulará esta operación y se revertirán sus impactos reales/comerciales.';
  }

  return (
    <div>
      <div className="bg-elevated border border-subtle rounded-lg p-5 mb-6">
        <div className="mb-3 min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-lg font-semibold text-fg min-w-0 break-words">
              Operación #{detail.operation_number}
            </h2>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
              detail.status === 'CANCELADA'
                ? 'bg-error-soft text-error'
                : 'bg-success-soft text-success'
            }`}>
              {displayStatus(detail.status)}
            </span>
          </div>
          {(canStartCorrection || canCancelOperation) && detail.status === 'CONFIRMADA' && (
            <FormActionsRow variant="table">
              {canStartCorrection && detail.type !== 'PENDIENTE_INICIAL' && (
                <button
                  type="button"
                  onClick={() => setPendingAction('modify')}
                  className="w-full min-h-[2rem] shrink-0 px-2 py-1 text-center text-xs text-brand border border-subtle rounded hover:bg-brand-soft transition sm:flex-1 sm:min-w-0"
                >
                  Modificar
                </button>
              )}
              {canCancelOperation && (
                <button
                  type="button"
                  onClick={() => setPendingAction('cancel')}
                  className="w-full min-h-[2rem] shrink-0 px-2 py-1 text-center text-xs text-error border border-error/30 rounded hover:bg-error-soft transition sm:flex-1 sm:min-w-0"
                >
                  Anular
                </button>
              )}
            </FormActionsRow>
          )}
          {canStartCorrection && detail.status === 'CANCELADA' && detail.type !== 'PENDIENTE_INICIAL' && (
            <FormActionsRow variant="table">
              <button
                type="button"
                onClick={() => setPendingAction('recreate')}
                className="w-full min-h-[2rem] px-2 py-1 text-center text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 transition"
              >
                Recrear desde esta
              </button>
            </FormActionsRow>
          )}
          {detail.type === 'PENDIENTE_INICIAL' && (detail.status === 'CONFIRMADA' || detail.status === 'CANCELADA') && (
            <p className="text-xs text-fg-muted max-w-xl">
              <strong>Pendiente inicial:</strong> no se puede modificar ni recrear por borrador (criterio contable).
              Altas nuevas desde <Link className="text-brand underline" to="/pendientes">Pendientes</Link>.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm">
          <div>
            <span className="text-fg-muted">Tipo:</span>{' '}
            <span className="font-medium">{movementTypeLabel(detail.type)}</span>
          </div>
          <div>
            <span className="text-fg-muted">Fecha:</span>{' '}
            <span className="font-medium">{detail.date}</span>
          </div>
          <div>
            <span className="text-fg-muted">Día:</span>{' '}
            <span className="font-medium">{detail.day_name}</span>
          </div>
          <div>
            <span className="text-fg-muted">Hora:</span>{' '}
            <span className="font-medium">{createdTime}</span>
          </div>
          <div>
            <span className="text-fg-muted">Cliente:</span>{' '}
            <span className="font-medium">{detail.client_name ?? '(Interno)'}</span>
          </div>
          {detail.note && (
            <div className="col-span-2 sm:col-span-3">
              <span className="text-fg-muted">Nota:</span>{' '}
              <span className="text-fg">{detail.note}</span>
            </div>
          )}
        </div>
      </div>

      {renderLinesTable(inLines, 'Entradas (IN)')}
      {renderLinesTable(outLines, 'Salidas (OUT)')}

      {detail.lines.length === 0 && (
        <p className="text-fg-muted text-sm">Este movimiento no tiene líneas registradas.</p>
      )}
      {pendingAction && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-md p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <h3 className="mb-2 text-lg font-semibold text-fg">{actionTitle(pendingAction)}</h3>
            <p className="mb-3 text-sm text-fg-muted">{actionDescription(pendingAction)}</p>
            <p className="mb-4 text-sm text-fg-muted">Operación #{detail.operation_number}</p>
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
                    pendingAction === 'cancel' ? 'bg-error hover:opacity-90' : 'bg-brand hover:bg-brand-hover'
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
