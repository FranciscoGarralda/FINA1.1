const arFormatter2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const arFormatter8 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function normalizeMoneyInput(input: string): string {
  let s = input.replace(/\./g, '').replace(',', '.');
  s = s.replace(/[^0-9.-]/g, '');
  const parts = s.split('.');
  if (parts.length > 2) {
    s = parts[0] + '.' + parts.slice(1).join('');
  }
  return s;
}

export function roundTo(value: number, fractionDigits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** fractionDigits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Redondeo half away from zero; alineado al cuadre VENTA/COMPRA en backend (2 decimales). */
export function roundHalfAwayFromZero(value: number, fractionDigits: number): number {
  if (!Number.isFinite(value)) return 0;
  const m = 10 ** fractionDigits;
  const scaled = value * m;
  const sign = scaled < 0 ? -1 : 1;
  const abs = Math.abs(scaled);
  const roundedInt = Math.floor(abs + 0.5);
  return (sign * roundedInt) / m;
}

/** Comparación estable del cuadre a 2 decimales (evita ruido float en ===). */
export function cuadreMatches2dp(a: number, b: number): boolean {
  return Math.round(roundHalfAwayFromZero(a, 2) * 100) === Math.round(roundHalfAwayFromZero(b, 2) * 100);
}

export function numberToNormalizedMoney(value: number, fractionDigits: number): string {
  return String(roundTo(value, fractionDigits));
}

export function formatMoneyAR(value: string | number, fractionDigits = 2): string {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return '';
  if (fractionDigits <= 2) return arFormatter2.format(num);
  return arFormatter8.format(num);
}
