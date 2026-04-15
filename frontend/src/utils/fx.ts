import { cuadreMatches2dp } from './money';

export type QuoteMode = 'MULTIPLY' | 'DIVIDE';

export function normalizeQuoteMode(mode?: string): QuoteMode {
  if (mode === 'DIVIDE') return 'DIVIDE';
  return 'MULTIPLY';
}

export function calculateEquivalent(baseAmount: number, rate: number, mode: QuoteMode): number {
  if (!Number.isFinite(baseAmount) || !Number.isFinite(rate) || baseAmount <= 0 || rate <= 0) return 0;
  if (mode === 'DIVIDE') return baseAmount / rate;
  return baseAmount * rate;
}

/** Inversa de calculateEquivalent para el mismo modo (total en divisa cotización → base). Alineado a impliedBaseFromQuoteTotal en backend. */
export function impliedBaseFromQuoteTotal(totalQuote: number, rate: number, mode: QuoteMode): number {
  if (!Number.isFinite(totalQuote) || !Number.isFinite(rate) || totalQuote <= 0 || rate <= 0) return 0;
  if (mode === 'DIVIDE') return totalQuote * rate;
  return totalQuote / rate;
}

export function cuadreVentaOk(
  outAmount: number,
  inSum: number,
  quoteRate: number,
  mode: QuoteMode,
  equivalent: number,
): boolean {
  if (cuadreMatches2dp(equivalent, inSum)) return true;
  if (inSum <= 0) return false;
  const implied = impliedBaseFromQuoteTotal(inSum, quoteRate, mode);
  return cuadreMatches2dp(outAmount, implied);
}

export function cuadreCompraOk(
  inAmount: number,
  outSum: number,
  quoteRate: number,
  mode: QuoteMode,
  equivalent: number,
): boolean {
  if (cuadreMatches2dp(equivalent, outSum)) return true;
  if (outSum <= 0) return false;
  const implied = impliedBaseFromQuoteTotal(outSum, quoteRate, mode);
  return cuadreMatches2dp(inAmount, implied);
}
