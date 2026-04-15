import { calculateEquivalent, normalizeQuoteMode, type QuoteMode } from './fx';
import { roundTo } from './money';

export type FeeTreatment = 'APARTE' | 'INCLUIDA';
export type FeeSettlement = 'REAL' | 'PENDIENTE';
export type FeePayer = 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS';
export type LegKind = 'out' | 'in';

export type SecondLegSuggestParams = {
  sameLegCurrency: boolean;
  feeEnabled: boolean;
  feeTreatment: FeeTreatment;
  feeSettlement: FeeSettlement;
  feePayer: FeePayer;
  firstLegKind: LegKind;
  secondLegKind: LegKind;
  feePendingSameCurrencyAsLegs: boolean;
  firstNum: number;
  /** Comisión ya resuelta para este paso (p. ej. % sobre la primera pata si aplica). */
  feeAmount: number;
};

/**
 * Monto sugerido para la segunda pata (misma divisa entre OUT e IN).
 * APARTE REAL: cliente paga ajusta el puente (OUT→IN neto; IN→OUT bruto); nosotros pagamos no ajusta.
 * APARTE PENDIENTE misma divisa que patas: sin mezclar fee (Problema 1).
 */
export function computeSuggestedSecondLegAmount(p: SecondLegSuggestParams): number {
  const { firstNum, feeAmount } = p;
  if (!p.sameLegCurrency || !Number.isFinite(firstNum) || firstNum <= 0) {
    return roundTo(Number.isFinite(firstNum) ? firstNum : 0, 2);
  }

  const fee = roundTo(Math.max(0, feeAmount || 0), 2);

  if (!p.feeEnabled) return roundTo(firstNum, 2);
  if (p.feeTreatment === 'INCLUIDA') return roundTo(firstNum, 2);

  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'PENDIENTE' && p.feePendingSameCurrencyAsLegs) {
    return roundTo(firstNum, 2);
  }

  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'PENDIENTE') {
    return roundTo(firstNum + fee, 2);
  }

  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'REAL') {
    if (p.feePayer === 'NOSOTROS_PAGAMOS') return roundTo(firstNum, 2);
    if (p.firstLegKind === 'out' && p.secondLegKind === 'in') {
      return roundTo(Math.max(0, firstNum - fee), 2);
    }
    if (p.firstLegKind === 'in' && p.secondLegKind === 'out') {
      return roundTo(firstNum + fee, 2);
    }
    return roundTo(firstNum, 2);
  }

  return roundTo(firstNum + fee, 2);
}

export type TransferFxParams = {
  outCurrencyId: string;
  inCurrencyId: string;
  functionalCurrencyId: string;
  quoteRate: number;
  quoteMode: QuoteMode;
};

/**
 * Con dos divisas (una = moneda funcional), calcula el monto de la otra pata
 * cuando `anchorAmount` es el monto de la pata OUT (anchorOnOut=true) o IN (false).
 * VENTA FX: OUT negociada, IN funcional → IN = f(OUT).
 * COMPRA FX: OUT funcional, IN negociada → OUT = f(IN).
 */
export function computeCounterpartFromAnchor(
  anchorAmount: number,
  anchorOnOut: boolean,
  p: TransferFxParams,
): number | null {
  const { outCurrencyId, inCurrencyId, functionalCurrencyId, quoteRate, quoteMode } = p;
  if (!outCurrencyId || !inCurrencyId || outCurrencyId === inCurrencyId) return null;
  if (!functionalCurrencyId) return null;
  const outF = outCurrencyId === functionalCurrencyId;
  const inF = inCurrencyId === functionalCurrencyId;
  if (!((outF && !inF) || (!outF && inF))) return null;
  if (!Number.isFinite(anchorAmount) || anchorAmount <= 0 || !Number.isFinite(quoteRate) || quoteRate <= 0) return null;

  const mode = normalizeQuoteMode(quoteMode);
  const inverse: QuoteMode = mode === 'MULTIPLY' ? 'DIVIDE' : 'MULTIPLY';

  if (!outF && inF) {
    // VENTA: OUT negociada → IN funcional
    if (anchorOnOut) return roundTo(calculateEquivalent(anchorAmount, quoteRate, mode), 2);
    return roundTo(calculateEquivalent(anchorAmount, quoteRate, inverse), 2);
  }
  // COMPRA: IN negociada → OUT funcional
  if (!anchorOnOut) return roundTo(calculateEquivalent(anchorAmount, quoteRate, mode), 2);
  return roundTo(calculateEquivalent(anchorAmount, quoteRate, inverse), 2);
}

/**
 * Inverso de {@link computeCounterpartFromAnchor}: dado el monto de la pata contraparte
 * (la que no es ancla en el UI), obtiene el monto ancla con la misma convención de tasa/modo.
 */
export function computeAnchorFromCounterpart(
  counterpartAmount: number,
  anchorOnOut: boolean,
  p: TransferFxParams,
): number | null {
  const { outCurrencyId, inCurrencyId, functionalCurrencyId, quoteRate, quoteMode } = p;
  if (!outCurrencyId || !inCurrencyId || outCurrencyId === inCurrencyId) return null;
  if (!functionalCurrencyId) return null;
  const outF = outCurrencyId === functionalCurrencyId;
  const inF = inCurrencyId === functionalCurrencyId;
  if (!((outF && !inF) || (!outF && inF))) return null;
  if (!Number.isFinite(counterpartAmount) || counterpartAmount <= 0 || !Number.isFinite(quoteRate) || quoteRate <= 0)
    return null;

  const mode = normalizeQuoteMode(quoteMode);
  const inverse: QuoteMode = mode === 'MULTIPLY' ? 'DIVIDE' : 'MULTIPLY';

  if (!outF && inF) {
    // VENTA: mismo mapa que computeCounterpartFromAnchor pero despejando OUT desde IN o IN desde OUT
    if (anchorOnOut)
      return roundTo(calculateEquivalent(counterpartAmount, quoteRate, inverse), 2);
    return roundTo(calculateEquivalent(counterpartAmount, quoteRate, mode), 2);
  }
  // COMPRA
  if (!anchorOnOut) return roundTo(calculateEquivalent(counterpartAmount, quoteRate, inverse), 2);
  return roundTo(calculateEquivalent(counterpartAmount, quoteRate, mode), 2);
}

export function secondLegSuggestionHint(p: {
  sameLegCurrency: boolean;
  feeEnabled: boolean;
  feeTreatment: FeeTreatment;
  feeSettlement: FeeSettlement;
  feePayer: FeePayer;
  firstLegKind: LegKind;
  feePendingSameCurrencyAsLegs: boolean;
}): string {
  if (!p.sameLegCurrency) return '';
  if (!p.feeEnabled) return 'Monto sugerido igual al de la primera pata (misma divisa).';
  if (p.feeTreatment === 'INCLUIDA') {
    return 'Monto sugerido igual al de la primera pata (comisión incluida; cargá patas coherentes con lo pactado).';
  }
  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'PENDIENTE' && p.feePendingSameCurrencyAsLegs) {
    return 'Monto sugerido igual al de la primera pata (comisión aparte pendiente: el importe de la comisión queda en su propia línea).';
  }
  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'PENDIENTE') {
    return 'Monto sugerido = primera pata + comisión calculada (comisión aparte pendiente en otra divisa respecto de las patas; editable).';
  }
  if (p.feeTreatment === 'APARTE' && p.feeSettlement === 'REAL') {
    if (p.feePayer === 'NOSOTROS_PAGAMOS') {
      return 'Monto sugerido igual al de la primera pata (nosotros pagamos la comisión aparte: el puente entre patas no suma ni resta la comisión; editable).';
    }
    if (p.firstLegKind === 'out') {
      return 'Monto sugerido = primera pata menos comisión (cliente paga, comisión aparte real; editable).';
    }
    return 'Monto sugerido = primera pata más comisión (cliente paga, comisión aparte real; editable).';
  }
  return 'Monto sugerido = primera pata + comisión calculada (misma divisa; editable).';
}
