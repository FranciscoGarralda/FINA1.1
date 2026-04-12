/** Disparar tras mutar pendientes para que otras vistas recarguen datos del API. */
export const MOVEMENTS_REFRESH_EVENT = 'fina:movements:refresh';

export type MovementsRefreshDetail = {
  /** Movimiento afectado; si falta, las vistas pueden recargar de forma amplia. */
  movementId?: string;
};
