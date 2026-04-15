import { describe, expect, it } from 'vitest';
import {
  computeAnchorFromCounterpart,
  computeCounterpartFromAnchor,
  computeSuggestedSecondLegAmount,
  secondLegSuggestionHint,
} from './transferenciaSecondLegSuggest';

const base = {
  sameLegCurrency: true,
  feeEnabled: true,
  feeTreatment: 'APARTE' as const,
  feeSettlement: 'REAL' as const,
  firstLegKind: 'out' as const,
  secondLegKind: 'in' as const,
  feePendingSameCurrencyAsLegs: false,
  firstNum: 1000,
  feeAmount: 20,
};

describe('computeSuggestedSecondLegAmount', () => {
  it('APARTE REAL cliente paga, primera OUT → segunda IN = primera − fee', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feePayer: 'CLIENTE_PAGA',
        firstLegKind: 'out',
        secondLegKind: 'in',
      }),
    ).toBe(980);
  });

  it('APARTE REAL cliente paga, primera IN → segunda OUT = primera + fee', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feePayer: 'CLIENTE_PAGA',
        firstLegKind: 'in',
        secondLegKind: 'out',
      }),
    ).toBe(1020);
  });

  it('APARTE REAL nosotros pagamos → igual a la primera', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feePayer: 'NOSOTROS_PAGAMOS',
        firstLegKind: 'out',
        secondLegKind: 'in',
      }),
    ).toBe(1000);
  });

  it('APARTE PENDIENTE misma divisa patas/fee → primera sola', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feeSettlement: 'PENDIENTE',
        feePendingSameCurrencyAsLegs: true,
        feePayer: 'CLIENTE_PAGA',
      }),
    ).toBe(1000);
  });

  it('APARTE PENDIENTE fee otra divisa → primera + fee', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feeSettlement: 'PENDIENTE',
        feePendingSameCurrencyAsLegs: false,
        feePayer: 'CLIENTE_PAGA',
      }),
    ).toBe(1020);
  });

  it('INCLUIDA → primera', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feeTreatment: 'INCLUIDA',
        feeSettlement: 'REAL',
        feePayer: 'CLIENTE_PAGA',
      }),
    ).toBe(1000);
  });

  it('no resta por debajo de cero', () => {
    expect(
      computeSuggestedSecondLegAmount({
        ...base,
        feePayer: 'CLIENTE_PAGA',
        firstLegKind: 'out',
        secondLegKind: 'in',
        firstNum: 10,
        feeAmount: 50,
      }),
    ).toBe(0);
  });
});

describe('secondLegSuggestionHint', () => {
  it('menciona menos comisión cuando cliente paga y primera es OUT', () => {
    const h = secondLegSuggestionHint({
      sameLegCurrency: true,
      feeEnabled: true,
      feeTreatment: 'APARTE',
      feeSettlement: 'REAL',
      feePayer: 'CLIENTE_PAGA',
      firstLegKind: 'out',
      feePendingSameCurrencyAsLegs: false,
    });
    expect(h).toContain('menos comisión');
  });

  it('menciona más comisión cuando cliente paga y primera es IN', () => {
    const h = secondLegSuggestionHint({
      sameLegCurrency: true,
      feeEnabled: true,
      feeTreatment: 'APARTE',
      feeSettlement: 'REAL',
      feePayer: 'CLIENTE_PAGA',
      firstLegKind: 'in',
      feePendingSameCurrencyAsLegs: false,
    });
    expect(h).toContain('más comisión');
  });
});

describe('computeCounterpartFromAnchor', () => {
  const usd = 'usd-id';
  const ars = 'ars-id';

  it('VENTA: OUT USD × tasa → IN ARS', () => {
    const v = computeCounterpartFromAnchor(1000, true, {
      outCurrencyId: usd,
      inCurrencyId: ars,
      functionalCurrencyId: ars,
      quoteRate: 1400,
      quoteMode: 'MULTIPLY',
    });
    expect(v).toBe(1400000);
  });

  it('COMPRA: IN USD × tasa → OUT ARS', () => {
    const v = computeCounterpartFromAnchor(1000, false, {
      outCurrencyId: ars,
      inCurrencyId: usd,
      functionalCurrencyId: ars,
      quoteRate: 1400,
      quoteMode: 'MULTIPLY',
    });
    expect(v).toBe(1400000);
  });
});

describe('computeAnchorFromCounterpart (inverso FX)', () => {
  const usd = 'usd-id';
  const ars = 'ars-id';

  const pVenta: Parameters<typeof computeAnchorFromCounterpart>[2] = {
    outCurrencyId: usd,
    inCurrencyId: ars,
    functionalCurrencyId: ars,
    quoteRate: 1400,
    quoteMode: 'MULTIPLY',
  };

  const pCompra: Parameters<typeof computeAnchorFromCounterpart>[2] = {
    outCurrencyId: ars,
    inCurrencyId: usd,
    functionalCurrencyId: ars,
    quoteRate: 1400,
    quoteMode: 'MULTIPLY',
  };

  /** Tras redondear el contraparte a 2 dec., inverso→directo debe recuperar ese mismo monto (punto fijo). */
  function expectFixedPoint(anchorOnOut: boolean, bundle: Parameters<typeof computeAnchorFromCounterpart>[2], anchor: number) {
    const cp = computeCounterpartFromAnchor(anchor, anchorOnOut, bundle);
    expect(cp).not.toBeNull();
    const back = computeAnchorFromCounterpart(cp as number, anchorOnOut, bundle);
    expect(back).not.toBeNull();
    const again = computeCounterpartFromAnchor(back as number, anchorOnOut, bundle);
    expect(again).toBe(cp);
  }

  it('punto fijo VENTA y COMPRA (MULTIPLY; coherencia 2 dec.)', () => {
    expectFixedPoint(true, pVenta, 1000);
    expectFixedPoint(false, pVenta, 777.77);
    expectFixedPoint(true, pCompra, 5000);
    expectFixedPoint(false, pCompra, 333.33);
  });

  it('punto fijo con modo DIVIDE', () => {
    const bundle = { ...pVenta, quoteMode: 'DIVIDE' as const, quoteRate: 25 };
    expectFixedPoint(true, bundle, 100);
    expectFixedPoint(false, bundle, 50.25);
  });

  it('inverso explícito VENTA OUT→IN: de IN hacia OUT', () => {
    const inAmt = 1400000;
    const out = computeAnchorFromCounterpart(inAmt, true, pVenta);
    expect(out).toBe(1000);
  });

  it('inverso explícito COMPRA: de OUT hacia IN', () => {
    const outAmt = 1400000;
    const inn = computeAnchorFromCounterpart(outAmt, false, pCompra);
    expect(inn).toBe(1000);
  });
});
