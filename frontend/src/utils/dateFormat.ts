const LOCALE = 'es-AR';

const dateDisplay = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeDisplay = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parseInputToDate(input: string): Date | null {
  const s = String(input).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split('-').map(Number);
    return new Date(y, mo - 1, d, 12, 0, 0, 0);
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/** `YYYY-MM-DD` en calendario local (valor inicial típico de `<input type="date" />`). */
export function todayLocalIsoDate(): string {
  return toLocalIsoDate(new Date());
}

/** Convierte un `Date` local a `YYYY-MM-DD` sin desfase por UTC. */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fecha legible según `es-AR` (p. ej. 15/04/2026).
 * Acepta `YYYY-MM-DD` o ISO 8601 con hora.
 */
export function formatDate(input: string): string {
  const d = parseInputToDate(input);
  if (!d) return input;
  return dateDisplay.format(d);
}

/**
 * Fecha y hora según `es-AR` en 24 h (p. ej. 15/04/2026, 14:30).
 */
export function formatDateTime(input: string): string {
  const d = parseInputToDate(input);
  if (!d) return input;
  return dateTimeDisplay.format(d);
}
