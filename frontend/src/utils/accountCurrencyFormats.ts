/**
 * Formato de movimiento en cuenta+divisa (alineado a account_currencies.cash_enabled / digital_enabled).
 */

export type MovementFormat = 'CASH' | 'DIGITAL';

interface AccountCurrencyRow {
  currency_id: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

function allowedFormatsFromRow(
  row: { cash_enabled: boolean; digital_enabled: boolean } | undefined | null,
): MovementFormat[] {
  if (!row) return [];
  const out: MovementFormat[] = [];
  if (row.cash_enabled) out.push('CASH');
  if (row.digital_enabled) out.push('DIGITAL');
  return out;
}

export function allowedFormatsFromList(
  list: AccountCurrencyRow[] | undefined,
  currencyId: string,
): MovementFormat[] {
  if (!list?.length || !currencyId) return [];
  const row = list.find((c) => c.currency_id === currencyId);
  return allowedFormatsFromRow(row);
}

/**
 * Mantiene el formato actual si sigue permitido; si no, el primero disponible (orden estable: CASH luego DIGITAL).
 */
export function resolveFormat(allowed: MovementFormat[], current: string): MovementFormat | '' {
  if (allowed.length === 0) return '';
  if (allowed.includes(current as MovementFormat)) return current as MovementFormat;
  return allowed[0];
}

export function formatLabel(f: MovementFormat): string {
  return f === 'CASH' ? 'Efectivo' : 'Digital';
}
