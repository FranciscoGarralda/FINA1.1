/**
 * Etiquetas y buckets unificados para pendientes (Fix Compra: H-004/H-005/H-006).
 *
 * Reglas:
 * - Nomenclatura única desde la óptica de la casa: "Pendiente de cobro" (la
 *   casa va a recibir → suma capital) vs "Pendiente de pago" (la casa va a
 *   entregar → resta capital).
 * - Los tipos backend (`PENDIENTE_DE_RETIRO` / `PENDIENTE_DE_PAGO`) NO cambian
 *   (regla 11: contratos API no se rompen sin decisión documentada). Solo
 *   cambia la capa de presentación.
 *
 * NOTA (deuda técnica conocida): no existen aún tipos compartidos
 * `PendingType` / `MovementType` en `frontend/src/types`. Mantengo firma
 * `string` para no inventar tipos (A.5). Tipado estricto queda como deuda.
 */

const RECEIVE = 'Pendiente de cobro';
const RECEIVE_OPENING = 'Pendiente de cobro (apertura)';
const PAY = 'Pendiente de pago';
const PAY_OPENING = 'Pendiente de pago (apertura)';
const COMMISSION_RECEIVE = 'Cobro comisión';
const COMMISSION_PAY = 'Pago comisión';

/** Etiqueta visible en pantalla para una fila de pendiente. Único punto de verdad. */
export function pendingTypeLabel(type: string, movementType?: string): string {
  if (movementType === 'PENDIENTE_INICIAL') {
    if (type === 'PENDIENTE_DE_RETIRO') return RECEIVE_OPENING;
    if (type === 'PENDIENTE_DE_PAGO') return PAY_OPENING;
  }
  if (movementType === 'VENTA') {
    if (type === 'PENDIENTE_DE_RETIRO') return PAY;
    if (type === 'PENDIENTE_DE_PAGO') return RECEIVE;
  }
  if (movementType === 'COMPRA') {
    if (type === 'PENDIENTE_DE_RETIRO') return RECEIVE;
    if (type === 'PENDIENTE_DE_PAGO') return PAY;
  }
  if (movementType === 'RETIRO_CAPITAL' && type === 'PENDIENTE_DE_RETIRO') return PAY;
  if (movementType === 'INGRESO_CAPITAL' && type === 'PENDIENTE_DE_PAGO') return RECEIVE;
  if (type === 'PENDIENTE_DE_COBRO_COMISION') return COMMISSION_RECEIVE;
  if (type === 'PENDIENTE_DE_PAGO_COMISION') return COMMISSION_PAY;
  // Fallback conservador (movement_type desconocido o sin contexto): tratar
  // ambos tipos como "Pendiente de pago" para no inflar capital. Cualquier
  // operación nueva debe pasar movement_type para mapear con precisión.
  if (type === 'PENDIENTE_DE_PAGO') return PAY;
  if (type === 'PENDIENTE_DE_RETIRO') return PAY;
  return type;
}

/** Bucket "Por cobrar" — la casa va a recibir → suma capital. */
export function isPendingPorCobrar(type: string, movementType?: string): boolean {
  const label = pendingTypeLabel(type, movementType);
  return label === RECEIVE || label === RECEIVE_OPENING || label === COMMISSION_RECEIVE;
}

/** Bucket "Por pagar" — la casa va a entregar → resta capital. */
export function isPendingPorPagar(type: string, movementType?: string): boolean {
  const label = pendingTypeLabel(type, movementType);
  return label === PAY || label === PAY_OPENING || label === COMMISSION_PAY;
}
