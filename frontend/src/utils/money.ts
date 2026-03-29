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

export function numberToNormalizedMoney(value: number, fractionDigits: number): string {
  return String(roundTo(value, fractionDigits));
}

export function formatMoneyAR(value: string | number, fractionDigits = 2): string {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) return '';
  if (fractionDigits <= 2) return arFormatter2.format(num);
  return arFormatter8.format(num);
}
