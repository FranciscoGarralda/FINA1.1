import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { movementTypeLabel } from '../utils/movementTypeLabels';
import { formatMoneyAR } from '../utils/money';
import { useAuth } from '../context/AuthContext';

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

  function loadDetail() {
    if (!id) return;
    setLoading(true);
    api
      .get<MovementDetail>(`/movements/${id}`)
      .then(setDetail)
      .catch(() => setError('No se pudo cargar el movimiento.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDetail();
  }, [id]);

  if (loading) return <p className="text-gray-500 text-sm p-4">Cargando...</p>;
  if (error || !detail) return <p className="text-red-600 text-sm p-4">{error || 'No encontrado.'}</p>;
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
    if (!line.is_pending) return 'text-gray-500';
    if (line.pending_status === 'RESUELTO') return 'text-green-600';
    if (line.pending_status === 'CANCELADO') return 'text-red-600';
    return 'text-yellow-600';
  }

  function renderLinesTable(lines: MovementLine[], title: string) {
    if (lines.length === 0) return null;
    return (
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-600 mb-2">{title}</h4>
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-3 py-2 font-medium text-gray-600">Cuenta</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Divisa</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Formato</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">Monto</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Pendiente</th>
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
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-3 min-w-0">
          <h2 className="text-lg font-semibold text-gray-800 min-w-0 break-words">
            Operación #{detail.operation_number}
          </h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
            detail.status === 'CANCELADA'
              ? 'bg-red-50 text-red-700'
              : 'bg-green-50 text-green-700'
          }`}>
            {displayStatus(detail.status)}
          </span>
          {canStartCorrection && detail.status === 'CONFIRMADA' && (
            <button
              onClick={() => setPendingAction('modify')}
              className="px-2 py-1 text-xs text-blue-700 border border-blue-300 rounded hover:bg-blue-50 transition"
            >
              Modificar
            </button>
          )}
          {canCancelOperation && detail.status === 'CONFIRMADA' && (
            <button
              onClick={() => setPendingAction('cancel')}
              className="px-2 py-1 text-xs text-red-700 border border-red-300 rounded hover:bg-red-50 transition"
            >
              Anular
            </button>
          )}
          {canStartCorrection && detail.status === 'CANCELADA' && (
            <button
              onClick={() => setPendingAction('recreate')}
              className="px-2 py-1 text-xs text-amber-700 border border-amber-300 rounded hover:bg-amber-50 transition"
            >
              Recrear desde esta
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-sm">
          <div>
            <span className="text-gray-500">Tipo:</span>{' '}
            <span className="font-medium">{movementTypeLabel(detail.type)}</span>
          </div>
          <div>
            <span className="text-gray-500">Fecha:</span>{' '}
            <span className="font-medium">{detail.date}</span>
          </div>
          <div>
            <span className="text-gray-500">Día:</span>{' '}
            <span className="font-medium">{detail.day_name}</span>
          </div>
          <div>
            <span className="text-gray-500">Hora:</span>{' '}
            <span className="font-medium">{createdTime}</span>
          </div>
          <div>
            <span className="text-gray-500">Cliente:</span>{' '}
            <span className="font-medium">{detail.client_name ?? '(Interno)'}</span>
          </div>
          {detail.note && (
            <div className="col-span-2 sm:col-span-3">
              <span className="text-gray-500">Nota:</span>{' '}
              <span className="text-gray-700">{detail.note}</span>
            </div>
          )}
        </div>
      </div>

      {renderLinesTable(inLines, 'Entradas (IN)')}
      {renderLinesTable(outLines, 'Salidas (OUT)')}

      {detail.lines.length === 0 && (
        <p className="text-gray-500 text-sm">Este movimiento no tiene líneas registradas.</p>
      )}
      {pendingAction && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-md p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
            <h3 className="mb-2 text-lg font-semibold text-gray-800">{actionTitle(pendingAction)}</h3>
            <p className="mb-3 text-sm text-gray-600">{actionDescription(pendingAction)}</p>
            <p className="mb-4 text-sm text-gray-500">Operación #{detail.operation_number}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingAction(null)}
                className="btn-touch text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={executePendingAction}
                className={`btn-touch text-white rounded-md ${
                  pendingAction === 'cancel' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
