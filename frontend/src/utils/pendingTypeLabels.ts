/** Etiqueta de fila en Pendientes; misma regla que en la tabla (sin drift). */
export function pendingTypeLabel(type: string, movementType?: string): string {
  if (movementType === 'PENDIENTE_INICIAL') {
    if (type === 'PENDIENTE_DE_RETIRO') return 'Entrega (apertura)';
    if (type === 'PENDIENTE_DE_PAGO') return 'Cobro (apertura)';
  }
  if (movementType === 'VENTA') {
    if (type === 'PENDIENTE_DE_RETIRO') return 'Entrega';
    if (type === 'PENDIENTE_DE_PAGO') return 'Retiro';
  }
  if (type === 'PENDIENTE_DE_PAGO') return 'Pago';
  if (type === 'PENDIENTE_DE_RETIRO') return 'Retiro';
  if (type === 'PENDIENTE_DE_COBRO_COMISION') return 'Cobro comisión';
  if (type === 'PENDIENTE_DE_PAGO_COMISION') return 'Pago comisión';
  return type;
}

/** Pendientes que en pantalla se listan como «Retiro» (incluye VENTA: cobro pendiente hacia la casa). */
export function isPendingUserFacingRetiro(type: string, movementType?: string): boolean {
  return pendingTypeLabel(type, movementType) === 'Retiro';
}
