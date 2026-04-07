/** Etiquetas de UI para `movements.type` (listados y detalle). */
export function movementTypeLabel(type: string): string {
  switch (type) {
    case 'COMPRA':
      return 'Compra';
    case 'VENTA':
      return 'Venta';
    case 'ARBITRAJE':
      return 'Arbitraje';
    case 'TRANSFERENCIA':
      return 'Transferencia';
    case 'TRANSFERENCIA_ENTRE_CUENTAS':
      return 'Transf. entre cuentas';
    case 'PAGO_CC_CRUZADO':
      return 'Pago CC cruzado';
    case 'TRASPASO_DEUDA_CC':
      return 'Traspaso deuda CC';
    case 'GASTO':
      return 'Gasto';
    case 'INGRESO_CAPITAL':
      return 'Ingreso capital';
    case 'RETIRO_CAPITAL':
      return 'Retiro capital';
    case 'PENDIENTE_INICIAL':
      return 'Pendiente inicial';
    default:
      return type;
  }
}
