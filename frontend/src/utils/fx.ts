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
