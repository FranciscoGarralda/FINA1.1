const baseClass = 'text-xs font-medium px-2 py-0.5 rounded inline-block';

type StatusBadgeProps = {
  /** Estado en mayúsculas o mixto (p. ej. CONFIRMADA, ABIERTO). */
  status: string;
  className?: string;
};

/**
 * Etiqueta de estado unificada (movimientos y pendientes).
 * Colores: BORRADOR ámbar, CONFIRMADA / RESUELTO verde, CANCELADA / CANCELADO rojo, ABIERTO advertencia.
 */
export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const s = String(status || '').trim().toUpperCase();
  let colors = 'bg-surface text-fg-muted';
  let label = status?.trim() || '—';

  switch (s) {
    case 'CANCELADA':
      colors = 'bg-error-soft text-error';
      label = 'ANULADA';
      break;
    case 'BORRADOR':
      colors = 'bg-amber-50 text-amber-700';
      label = 'BORRADOR';
      break;
    case 'CONFIRMADA':
      colors = 'bg-success-soft text-success';
      label = 'CONFIRMADA';
      break;
    case 'ABIERTO':
      colors = 'bg-warning-soft text-warning';
      label = 'Abierto';
      break;
    case 'RESUELTO':
      colors = 'bg-success-soft text-success';
      label = 'Resuelto';
      break;
    case 'CANCELADO':
      colors = 'bg-error-soft text-error';
      label = 'Cancelado';
      break;
    default:
      break;
  }

  return <span className={`${baseClass} ${colors}${className ? ` ${className}` : ''}`}>{label}</span>;
}
