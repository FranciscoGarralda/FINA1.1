import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import ApiErrorBanner from '../common/ApiErrorBanner';
import { formatMoneyAR, numberToNormalizedMoney, roundTo } from '../../utils/money';
import { normalizeQuoteMode, type QuoteMode } from '../../utils/fx';
import {
  computeCounterpartFromAnchor,
  computeSuggestedSecondLegAmount,
  secondLegSuggestionHint,
} from '../../utils/transferenciaSecondLegSuggest';
import { saveOperationDraft } from '../../utils/operationDrafts';
import { allowedFormatsFromList, formatLabel } from '../../utils/accountCurrencyFormats';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';
import OperationFormActions from './OperationFormActions';

interface AccountCurrency {
  currency_id: string;
  currency_code: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

interface Props {
  movementId: string;
  clientId: string;
  /** Si false, no hay impacto CC: el resumen no muestra montos en CC (alineado al backend). */
  clientCcEnabled: boolean;
  onDone: () => void;
  onCancel: () => void;
}

interface TransferState {
  account_id: string;
  currency_id: string;
  format: '' | 'CASH' | 'DIGITAL';
  amount: string;
  settlement: 'REAL' | 'PENDIENTE';
}

interface TransferenciaDraftData {
  out_leg: TransferState;
  in_leg: TransferState;
  /** Cotización del cruce mesa (opcional; dual divisas + moneda funcional). */
  quote?: { rate: string; mode: QuoteMode; currency_id?: string };
  feeEnabled: boolean;
  feeMode: 'PERCENT' | 'FIXED';
  feeValue: string;
  feeTreatment: 'APARTE' | 'INCLUIDA';
  feePayer: 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS';
  feeSettlement: 'REAL' | 'PENDIENTE';
  feeCurrencyId: string;
  feeAccountId: string;
  feeFormat: '' | 'CASH' | 'DIGITAL';
}

interface LegacyTransferenciaDraftData {
  out_leg?: TransferState;
  in_leg?: TransferState;
  delivery?: {
    account_id?: string;
    currency_id?: string;
    format?: string;
    amount?: string;
    settlement?: 'REAL' | 'OWED_PENDING';
  };
  feeEnabled?: boolean;
  feeMode?: 'PERCENT' | 'FIXED';
  feeValue?: string;
  feeSign?: 'PLUS' | 'MINUS';
  feeTreatment?: 'APARTE' | 'INCLUIDA';
  feePayer?: 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS';
  feeSettlement?: 'REAL' | 'PENDIENTE';
  feeCurrencyId?: string;
  feeAccountId?: string;
  feeFormat?: '' | 'CASH' | 'DIGITAL';
  transfer?: {
    account_id?: string;
    currency_id?: string;
    format?: '' | 'CASH' | 'DIGITAL';
    amount?: string;
    pending?: boolean;
  };
}

interface DraftPayloadEnvelope<TData> {
  schema_version: number;
  operation_type: string;
  data: TData;
}

interface DraftApiResponse<TData> {
  movement_id: string;
  payload?: DraftPayloadEnvelope<TData>;
  updated_at?: string;
}

const emptyLeg = (): TransferState => ({
  account_id: '',
  currency_id: '',
  format: '',
  amount: '',
  settlement: 'REAL',
});

function normalizeFormat(value: unknown): '' | 'CASH' | 'DIGITAL' {
  if (value === 'CASH' || value === 'DIGITAL') return value;
  return '';
}

function mapDraft(draft: TransferenciaDraftData | LegacyTransferenciaDraftData): TransferenciaDraftData {
  const anyDraft = draft as any;
  if (anyDraft?.out_leg || anyDraft?.in_leg) {
    const q = anyDraft.quote;
    return {
      out_leg: { ...emptyLeg(), ...anyDraft.out_leg },
      in_leg: { ...emptyLeg(), ...anyDraft.in_leg },
      quote: q?.rate
        ? {
            rate: String(q.rate),
            mode: normalizeQuoteMode(q.mode as string | undefined),
            currency_id: typeof q.currency_id === 'string' ? q.currency_id : undefined,
          }
        : undefined,
      feeEnabled: Boolean(anyDraft.feeEnabled),
      feeMode: anyDraft.feeMode || 'PERCENT',
      feeValue: anyDraft.feeValue || '',
      feeTreatment: anyDraft.feeTreatment || (anyDraft.feeSign === 'MINUS' ? 'INCLUIDA' : 'APARTE'),
      feePayer: anyDraft.feePayer || 'CLIENTE_PAGA',
      feeSettlement: anyDraft.feeSettlement || 'REAL',
      feeCurrencyId: anyDraft.feeCurrencyId || '',
      feeAccountId: anyDraft.feeAccountId || '',
      feeFormat: normalizeFormat(anyDraft.feeFormat),
    };
  }

  const delivery = anyDraft?.delivery || {};
  const firstCollection = Array.isArray(anyDraft?.collections) && anyDraft.collections.length > 0 ? anyDraft.collections[0] : null;
  const transfer = anyDraft?.transfer || {};

  const outFromTransfer = String(transfer.amount || '').trim().startsWith('-');
  const inFromTransfer = String(transfer.amount || '').trim() && !outFromTransfer;

  return {
    out_leg: {
      account_id: delivery.account_id || (outFromTransfer ? transfer.account_id || '' : ''),
      currency_id: delivery.currency_id || (outFromTransfer ? transfer.currency_id || '' : ''),
      format: normalizeFormat(delivery.format || transfer.format),
      amount: delivery.amount || (outFromTransfer ? String(transfer.amount || '').replace('-', '') : ''),
      settlement: delivery.settlement === 'OWED_PENDING' || transfer.pending ? 'PENDIENTE' : 'REAL',
    },
    in_leg: {
      account_id: firstCollection?.account_id || (inFromTransfer ? transfer.account_id || '' : ''),
      currency_id: firstCollection?.currency_id || (inFromTransfer ? transfer.currency_id || '' : ''),
      format: normalizeFormat(firstCollection?.format || transfer.format),
      amount: firstCollection?.amount || (inFromTransfer ? String(transfer.amount || '') : ''),
      settlement: firstCollection?.settlement === 'OWED_PENDING' ? 'PENDIENTE' : 'REAL',
    },
    feeEnabled: Boolean(anyDraft?.feeEnabled),
    feeMode: anyDraft?.feeMode || 'PERCENT',
    feeValue: anyDraft?.feeValue || '',
    feeTreatment: anyDraft?.feeTreatment || (anyDraft?.feeSign === 'MINUS' ? 'INCLUIDA' : 'APARTE'),
    feePayer: anyDraft?.feePayer || 'CLIENTE_PAGA',
    feeSettlement: anyDraft?.feeSettlement || 'REAL',
    feeCurrencyId: anyDraft?.feeCurrencyId || '',
    feeAccountId: anyDraft?.feeAccountId || '',
    feeFormat: normalizeFormat(anyDraft?.feeFormat),
  };
}

function feeComisionadoExplainer(
  feeTreatment: 'APARTE' | 'INCLUIDA',
  feePayer: 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS',
): string {
  if (feeTreatment === 'INCLUIDA') {
    const base =
      'Incluida: el % o el fijo se calcula sobre la pata en la misma divisa que la comisión; sin línea aparte de comisión en CC. El backend no reparte el bruto: se guardan las patas tal cual.';
    if (feePayer === 'CLIENTE_PAGA') {
      return `${base} Cliente paga: patas con el total acordado.`;
    }
    return `${base} Nosotros pagamos: patas con el neto al cliente; la comisión no se cobra aparte en CC.`;
  }
  if (feePayer === 'CLIENTE_PAGA') {
    return 'La comisión va aparte; aumenta la deuda del cliente en CC (saldo más negativo en la convención actual).';
  }
  return 'La comisión la asume la casa; mejora la posición del cliente en CC (menos deuda / más a favor).';
}

function impactoClienteCcCierre(
  clientCcEnabled: boolean,
  feeEnabled: boolean,
  feeTreatment: 'APARTE' | 'INCLUIDA',
  feePayer: 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS',
): string | null {
  if (!clientCcEnabled) return null;
  if (!feeEnabled) {
    return 'Efecto CC: la salida resta y la entrada suma en cuenta corriente por divisa. CC negativo = más deuda del cliente en esa moneda.';
  }
  if (feeTreatment === 'INCLUIDA') {
    const base =
      'Efecto CC: sin línea extra por comisión; todo en patas. CC negativo = más deuda del cliente en esa moneda.';
    if (feePayer === 'CLIENTE_PAGA') {
      return `${base} Cliente paga: coherente con bruto en patas.`;
    }
    return `${base} Nosotros pagamos: neto al cliente en patas.`;
  }
  if (feePayer === 'CLIENTE_PAGA') {
    return 'Efecto CC: además de salida/entrada, la comisión aparte empeora el saldo del cliente en la divisa de la comisión (más negativo). CC negativo = más deuda del cliente en esa moneda.';
  }
  return 'Efecto CC: además de salida/entrada, la comisión aparte asumida por la casa mejora el saldo del cliente en la divisa de la comisión (menos negativo / más a favor). CC negativo = más deuda del cliente en esa moneda.';
}

export default function TransferenciaForm({
  movementId,
  clientId: _clientId,
  clientCcEnabled,
  onDone,
  onCancel,
}: Props) {
  const localDraftKey = `transferencia_local_draft:${movementId}`;
  const accounts = useActiveAccounts();
  const [acCache, setAcCache] = useState<Record<string, AccountCurrency[]>>({});

  const [outLeg, setOutLeg] = useState<TransferState>(emptyLeg());
  const [inLeg, setInLeg] = useState<TransferState>(emptyLeg());
  const [feeEnabled, setFeeEnabled] = useState(false);
  const [feeMode, setFeeMode] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [feeValue, setFeeValue] = useState('');
  const [feeTreatment, setFeeTreatment] = useState<'APARTE' | 'INCLUIDA'>('APARTE');
  const [feePayer, setFeePayer] = useState<'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS'>('CLIENTE_PAGA');
  const [feeSettlement, setFeeSettlement] = useState<'REAL' | 'PENDIENTE'>('REAL');
  const [feeCurrencyId, setFeeCurrencyId] = useState('');
  const [feeAccountId, setFeeAccountId] = useState('');
  const [feeFormat, setFeeFormat] = useState<'' | 'CASH' | 'DIGITAL'>('');

  const [fxFunctionalCurrencyId, setFxFunctionalCurrencyId] = useState<string | null>(null);
  const [quoteRate, setQuoteRate] = useState('');
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('MULTIPLY');

  /** Solo UI; no va en borrador ni en API. */
  const [firstLegDirection, setFirstLegDirection] = useState<'SALIDA' | 'INGRESO'>('SALIDA');
  const [p2UserEdited, setP2UserEdited] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [currenciesLoadError, setCurrenciesLoadError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  const [calcBruto, setCalcBruto] = useState('');
  const [calcFeeMode, setCalcFeeMode] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [calcFeeValue, setCalcFeeValue] = useState('');
  const [calcClipboardErr, setCalcClipboardErr] = useState<string | null>(null);

  useEffect(() => {
    const accountIds = [outLeg.account_id, inLeg.account_id, feeAccountId].filter(Boolean);
    accountIds.forEach((accountId) => {
      if (!accountId || acCache[accountId]) return;
      api
        .get<AccountCurrency[]>(`/accounts/${accountId}/currencies`)
        .then((ac) => {
          setAcCache((p) => ({ ...p, [accountId]: ac }));
          setCurrenciesLoadError('');
        })
        .catch(() => {
          setAcCache((p) => ({ ...p, [accountId]: [] }));
          setCurrenciesLoadError('No se pudieron cargar las divisas de una cuenta. Revisá la conexión.');
        });
    });
  }, [outLeg.account_id, inLeg.account_id, feeAccountId, acCache]);

  useEffect(() => {
    if (feeTreatment === 'INCLUIDA' && feeSettlement !== 'REAL') {
      setFeeSettlement('REAL');
    }
  }, [feeTreatment, feeSettlement]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const currencies = await api.get<Array<{ id: string; code: string }>>('/currencies');
        if (cancelled) return;
        let code = 'ARS';
        try {
          const settings = await api.get<Record<string, unknown>>('/settings');
          const raw = settings.fx_functional_currency_code;
          if (typeof raw === 'string') {
            try {
              code = JSON.parse(raw) as string;
            } catch {
              code = raw.replace(/^"|"$/g, '');
            }
          }
        } catch {
          // Sin permiso a settings: fallback ARS.
        }
        const row = currencies.find((c) => c.code?.toUpperCase() === String(code).toUpperCase());
        setFxFunctionalCurrencyId(row?.id ?? null);
      } catch {
        if (!cancelled) setFxFunctionalCurrencyId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!feeEnabled || !feeCurrencyId) return;
    if (feeCurrencyId === outLeg.currency_id && outLeg.account_id && outLeg.format) {
      setFeeAccountId(outLeg.account_id);
      setFeeFormat(outLeg.format);
      return;
    }
    if (feeCurrencyId === inLeg.currency_id && inLeg.account_id && inLeg.format) {
      setFeeAccountId(inLeg.account_id);
      setFeeFormat(inLeg.format);
    }
  }, [
    feeEnabled,
    feeCurrencyId,
    outLeg.account_id,
    outLeg.currency_id,
    outLeg.format,
    inLeg.account_id,
    inLeg.currency_id,
    inLeg.format,
  ]);

  useEffect(() => {
    if (!feeAccountId) return;
    const availableCurrencies = acCache[feeAccountId] || [];
    if (feeCurrencyId && !availableCurrencies.some((c) => c.currency_id === feeCurrencyId)) {
      setFeeCurrencyId('');
      setFeeFormat('');
    }
  }, [feeAccountId, feeCurrencyId, acCache]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    const applyMappedDraft = (mapped: TransferenciaDraftData) => {
      setOutLeg(mapped.out_leg);
      setInLeg(mapped.in_leg);
      setFeeEnabled(mapped.feeEnabled);
      setFeeMode(mapped.feeMode);
      setFeeValue(mapped.feeValue);
      setFeeTreatment(mapped.feeTreatment);
      setFeePayer(mapped.feePayer);
      setFeeSettlement(mapped.feeSettlement);
      setFeeCurrencyId(mapped.feeCurrencyId);
      setFeeAccountId(mapped.feeAccountId);
      setFeeFormat(mapped.feeFormat);
      if (mapped.quote?.rate) {
        setQuoteRate(mapped.quote.rate);
        setQuoteMode(normalizeQuoteMode(mapped.quote.mode));
      } else {
        setQuoteRate('');
        setQuoteMode('MULTIPLY');
      }
      setFirstLegDirection('SALIDA');
      const o = mapped.out_leg.amount.trim();
      const i = mapped.in_leg.amount.trim();
      setP2UserEdited(o !== '' && i !== '' && o !== i);
    };

    const applyLocalFallback = () => {
      try {
        const raw = localStorage.getItem(localDraftKey);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as TransferenciaDraftData | LegacyTransferenciaDraftData;
        const mapped = mapDraft(parsed);
        applyMappedDraft(mapped);
        setDraftMessage('Se recuperó un borrador local de esta operación.');
        return true;
      } catch {
        return false;
      }
    };

    api
      .get<DraftApiResponse<TransferenciaDraftData | LegacyTransferenciaDraftData>>(`/movements/${movementId}/draft`)
      .then((res) => {
        if (cancelled) return;
        const payload = res?.payload;
        if (!payload || payload.operation_type !== 'TRANSFERENCIA') {
          applyLocalFallback();
          return;
        }
        const draft = payload.data;
        if (!draft || (typeof draft === 'object' && Object.keys(draft as Record<string, unknown>).length === 0)) {
          if (!applyLocalFallback()) {
            setDraftMessage('El borrador existe pero no tenía datos del formulario guardados. Completá y guardá borrador.');
          }
          return;
        }
        const mapped = mapDraft(draft);
        applyMappedDraft(mapped);
        try {
          localStorage.setItem(localDraftKey, JSON.stringify(mapped));
        } catch {
          // non-blocking
        }
        setDraftMessage('Borrador reanudado.');
      })
      .catch(() => {
        if (!cancelled) applyLocalFallback();
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementId, localDraftKey]);

  const firstLegKind: 'out' | 'in' = firstLegDirection === 'SALIDA' ? 'out' : 'in';
  const secondLegKind: 'out' | 'in' = firstLegKind === 'out' ? 'in' : 'out';

  const outAC = useMemo(() => acCache[outLeg.account_id] || [], [acCache, outLeg.account_id]);
  const inAC = useMemo(() => acCache[inLeg.account_id] || [], [acCache, inLeg.account_id]);
  const feeAC = useMemo(() => acCache[feeAccountId] || [], [acCache, feeAccountId]);

  const outCurrCode = useMemo(() => outAC.find((c) => c.currency_id === outLeg.currency_id)?.currency_code || '', [outAC, outLeg.currency_id]);
  const inCurrCode = useMemo(() => inAC.find((c) => c.currency_id === inLeg.currency_id)?.currency_code || '', [inAC, inLeg.currency_id]);
  const feeCurrCode = useMemo(() => {
    const inCode = inAC.find((c) => c.currency_id === feeCurrencyId)?.currency_code;
    const outCode = outAC.find((c) => c.currency_id === feeCurrencyId)?.currency_code;
    const feeCode = feeAC.find((c) => c.currency_id === feeCurrencyId)?.currency_code;
    return feeCode || inCode || outCode || '';
  }, [feeAC, inAC, outAC, feeCurrencyId]);

  const feeLegCurrencyOptions = useMemo(() => {
    const m = new Map<string, { currency_id: string; currency_code: string }>();
    for (const c of outAC) m.set(c.currency_id, c);
    for (const c of inAC) {
      if (!m.has(c.currency_id)) m.set(c.currency_id, c);
    }
    if (feeAccountId) {
      for (const c of feeAC) {
        if (!m.has(c.currency_id)) m.set(c.currency_id, c);
      }
    }
    return [...m.values()];
  }, [outAC, inAC, feeAC, feeAccountId]);

  const needsFxQuote = useMemo(() => {
    if (!outLeg.currency_id || !inLeg.currency_id || outLeg.currency_id === inLeg.currency_id) return false;
    if (!fxFunctionalCurrencyId) return false;
    return outLeg.currency_id === fxFunctionalCurrencyId || inLeg.currency_id === fxFunctionalCurrencyId;
  }, [outLeg.currency_id, inLeg.currency_id, fxFunctionalCurrencyId]);

  const feeAccountDerivesFromLeg = useMemo(() => {
    if (!feeCurrencyId) return false;
    return feeCurrencyId === outLeg.currency_id || feeCurrencyId === inLeg.currency_id;
  }, [feeCurrencyId, outLeg.currency_id, inLeg.currency_id]);

  const outAmount = useMemo(() => parseFloat(outLeg.amount), [outLeg.amount]);
  const inAmount = useMemo(() => parseFloat(inLeg.amount), [inLeg.amount]);
  const outAbs = useMemo(() => roundTo(Math.abs(outAmount || 0), 2), [outAmount]);
  const inAbs = useMemo(() => roundTo(Math.abs(inAmount || 0), 2), [inAmount]);

  useEffect(() => {
    if (!needsFxQuote || p2UserEdited || !fxFunctionalCurrencyId) return;
    const rate = parseFloat(String(quoteRate).trim().replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) return;
    const firstNum = firstLegKind === 'out' ? outAmount : inAmount;
    if (!Number.isFinite(firstNum) || firstNum <= 0) return;
    const counterpart = computeCounterpartFromAnchor(firstNum, firstLegKind === 'out', {
      outCurrencyId: outLeg.currency_id,
      inCurrencyId: inLeg.currency_id,
      functionalCurrencyId: fxFunctionalCurrencyId,
      quoteRate: rate,
      quoteMode: normalizeQuoteMode(quoteMode),
    });
    if (counterpart == null || !Number.isFinite(counterpart)) return;
    const plain = String(roundTo(counterpart, 2));
    if (secondLegKind === 'out') {
      setOutLeg((prev) => (prev.amount === plain ? prev : { ...prev, amount: plain }));
    } else {
      setInLeg((prev) => (prev.amount === plain ? prev : { ...prev, amount: plain }));
    }
  }, [
    needsFxQuote,
    p2UserEdited,
    fxFunctionalCurrencyId,
    quoteRate,
    quoteMode,
    firstLegKind,
    secondLegKind,
    outAmount,
    inAmount,
    outLeg.currency_id,
    inLeg.currency_id,
  ]);

  const expectedFee = useMemo(() => {
    const feeNum = parseFloat(feeValue);
    if (!feeEnabled || !Number.isFinite(feeNum) || feeNum <= 0) return 0;
    if (feeMode === 'PERCENT') {
      const base = feeCurrencyId === outLeg.currency_id ? outAbs : inAbs;
      return roundTo(base * feeNum / 100, 2);
    }
    return roundTo(feeNum, 2);
  }, [feeEnabled, feeMode, feeValue, outAbs, inAbs, feeCurrencyId, outLeg.currency_id]);

  const includedNetAmount = useMemo(() => {
    if (!feeEnabled || feeTreatment !== 'INCLUIDA') return outAbs;
    return roundTo(outAbs - expectedFee, 2);
  }, [outAbs, feeEnabled, feeTreatment, expectedFee]);

  const calcHelpActive = feeEnabled && feeTreatment === 'INCLUIDA';

  const calcDerived = useMemo(() => {
    const empty = {
      helpAlert: null as string | null,
      roundWarning: null as string | null,
      bruto: null as number | null,
      feeCalc: null as number | null,
      netoCalc: null as number | null,
      showNumeric: false,
    };
    if (!calcHelpActive) return empty;

    const rawBruto = calcBruto.trim().replace(',', '.');
    if (!rawBruto) {
      return { ...empty, helpAlert: 'Ingresá un bruto mayor a 0.' };
    }
    const brutoParsed = parseFloat(rawBruto);
    if (!Number.isFinite(brutoParsed) || brutoParsed <= 0) {
      return { ...empty, helpAlert: 'Ingresá un bruto mayor a 0.' };
    }
    const bruto = roundTo(brutoParsed, 2);

    const rawFee = calcFeeValue.trim().replace(',', '.');
    const feeParsed = parseFloat(rawFee);
    let feeCalc = 0;
    if (calcFeeMode === 'PERCENT') {
      if (!Number.isFinite(feeParsed) || feeParsed < 0) {
        return { ...empty, helpAlert: 'Valor % inválido.' };
      }
      feeCalc = roundTo((bruto * feeParsed) / 100, 2);
    } else {
      if (!Number.isFinite(feeParsed) || feeParsed < 0) {
        return { ...empty, helpAlert: 'Monto fijo inválido.' };
      }
      feeCalc = roundTo(feeParsed, 2);
    }

    if (feeCalc > bruto) {
      return { ...empty, helpAlert: 'La comisión no puede superar el bruto.', bruto, feeCalc };
    }
    const netoCalc = roundTo(bruto - feeCalc, 2);
    if (netoCalc <= 0) {
      return {
        ...empty,
        helpAlert: 'El neto debe ser mayor a 0 (revisá bruto/comisión).',
        bruto,
        feeCalc,
        netoCalc,
      };
    }
    const sum = roundTo(netoCalc + feeCalc, 2);
    const roundWarning = Math.abs(sum - bruto) > 0.01 ? 'Revisá redondeo.' : null;
    return { helpAlert: null, roundWarning, bruto, feeCalc, netoCalc, showNumeric: true };
  }, [calcHelpActive, calcBruto, calcFeeMode, calcFeeValue]);

  async function copyCalcPlainToClipboard(value: number) {
    const plain = String(roundTo(value, 2));
    try {
      await navigator.clipboard.writeText(plain);
      setCalcClipboardErr(null);
    } catch {
      setCalcClipboardErr('No se pudo copiar; seleccioná manualmente.');
    }
  }

  const outPendingLabel = outLeg.settlement === 'PENDIENTE' ? 'Sí' : 'No';
  const inPendingLabel = inLeg.settlement === 'PENDIENTE' ? 'Sí' : 'No';
  const feeComisionadoText = useMemo(() => feeComisionadoExplainer(feeTreatment, feePayer), [feeTreatment, feePayer]);
  const settlementLabel = (settlement: 'REAL' | 'PENDIENTE') => (settlement === 'REAL' ? 'Liquidado ahora' : 'Queda pendiente');
  const feeAmountSigned = expectedFee > 0 ? (feePayer === 'CLIENTE_PAGA' ? -expectedFee : expectedFee) : 0;
  const feeRealSigned = feeEnabled && feeTreatment === 'APARTE' && feeSettlement === 'REAL' ? feeAmountSigned : 0;
  const feePendingSigned = feeEnabled && feeTreatment === 'APARTE' && feeSettlement === 'PENDIENTE' ? feeAmountSigned : 0;

  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, { code: string; cc: number; real: number; pending: number }> = {};
    const add = (currencyId: string, code: string, bucket: 'cc' | 'real' | 'pending', amount: number) => {
      if (!currencyId || !amount) return;
      if (!totals[currencyId]) totals[currencyId] = { code: code || currencyId, cc: 0, real: 0, pending: 0 };
      totals[currencyId][bucket] = roundTo(totals[currencyId][bucket] + amount, 2);
    };

    if (clientCcEnabled) {
      add(outLeg.currency_id, outCurrCode, 'cc', outLeg.settlement === 'REAL' ? -outAbs : 0);
      add(inLeg.currency_id, inCurrCode, 'cc', inLeg.settlement === 'REAL' ? inAbs : 0);
    }

    add(outLeg.currency_id, outCurrCode, 'real', outLeg.settlement === 'REAL' ? -outAbs : 0);
    add(inLeg.currency_id, inCurrCode, 'real', inLeg.settlement === 'REAL' ? inAbs : 0);

    add(outLeg.currency_id, outCurrCode, 'pending', outLeg.settlement === 'PENDIENTE' ? -outAbs : 0);
    add(inLeg.currency_id, inCurrCode, 'pending', inLeg.settlement === 'PENDIENTE' ? inAbs : 0);

    if (feeEnabled && expectedFee > 0 && feeCurrCode) {
      if (clientCcEnabled && feeTreatment === 'APARTE' && feeSettlement === 'REAL') {
        add(feeCurrencyId, feeCurrCode, 'cc', feeAmountSigned);
      }
      add(feeCurrencyId, feeCurrCode, 'real', feeRealSigned);
      add(feeCurrencyId, feeCurrCode, 'pending', feePendingSigned);
    }

    return Object.values(totals);
  }, [
    clientCcEnabled,
    outLeg.currency_id,
    outCurrCode,
    outAbs,
    outLeg.settlement,
    inLeg.currency_id,
    inCurrCode,
    inAbs,
    inLeg.settlement,
    feeEnabled,
    feeTreatment,
    feeSettlement,
    expectedFee,
    feeCurrCode,
    feeCurrencyId,
    feeAmountSigned,
    feeRealSigned,
    feePendingSigned,
  ]);

  const sameLegCurrency = Boolean(outLeg.currency_id && outLeg.currency_id === inLeg.currency_id);
  const secondLegSuggestHint = sameLegCurrency ? '' : 'Divisas distintas — cargá cada monto por separado.';

  const feePendingSameCurrencyAsLegs = Boolean(
    feeCurrencyId &&
      feeCurrencyId === outLeg.currency_id &&
      feeCurrencyId === inLeg.currency_id,
  );

  const secondLegActiveSuggestHint = useMemo(
    () =>
      secondLegSuggestionHint({
        sameLegCurrency,
        feeEnabled,
        feeTreatment,
        feeSettlement,
        feePayer,
        firstLegKind,
        feePendingSameCurrencyAsLegs,
      }),
    [sameLegCurrency, feeEnabled, feeTreatment, feeSettlement, feePayer, firstLegKind, feePendingSameCurrencyAsLegs],
  );

  useEffect(() => {
    if (p2UserEdited) return;
    if (!sameLegCurrency) return;
    const fk = firstLegKind === 'out' ? outLeg : inLeg;
    const sk = secondLegKind === 'out' ? outLeg : inLeg;
    const firstNum = parseFloat(fk.amount);
    if (!Number.isFinite(firstNum) || firstNum <= 0) return;

    const firstLegCur = fk.currency_id;
    let feeForSuggest = expectedFee;
    if (
      feeEnabled &&
      feeTreatment === 'APARTE' &&
      feeMode === 'PERCENT' &&
      feeCurrencyId &&
      firstLegCur &&
      feeCurrencyId === firstLegCur
    ) {
      const pct = parseFloat(feeValue);
      if (Number.isFinite(pct) && pct > 0) feeForSuggest = roundTo((firstNum * pct) / 100, 2);
    }

    const suggestedNum = computeSuggestedSecondLegAmount({
      sameLegCurrency,
      feeEnabled,
      feeTreatment,
      feeSettlement,
      feePayer,
      firstLegKind,
      secondLegKind,
      feePendingSameCurrencyAsLegs,
      firstNum,
      feeAmount: feeForSuggest,
    });

    const nextStr = String(suggestedNum);
    if (sk.amount.trim() === nextStr.trim()) return;

    if (secondLegKind === 'out') {
      setOutLeg((prev) => ({ ...prev, amount: nextStr }));
    } else {
      setInLeg((prev) => ({ ...prev, amount: nextStr }));
    }
  }, [
    p2UserEdited,
    sameLegCurrency,
    firstLegKind,
    secondLegKind,
    outLeg,
    inLeg,
    feeEnabled,
    feeTreatment,
    feeSettlement,
    feePendingSameCurrencyAsLegs,
    expectedFee,
    feePayer,
    feeMode,
    feeValue,
    feeCurrencyId,
  ]);

  function formatsFor(accountId: string, currencyId: string): Array<'CASH' | 'DIGITAL'> {
    if (!accountId || !currencyId) return [];
    return allowedFormatsFromList(acCache[accountId] || [], currencyId);
  }

  function updateLeg(kind: 'out' | 'in', field: keyof TransferState, value: string) {
    const setter = kind === 'out' ? setOutLeg : setInLeg;
    setter((prev) => {
      const next = { ...prev, [field]: value } as TransferState;
      if (field === 'account_id') {
        next.currency_id = '';
        next.format = '';
      }
      if (field === 'currency_id') {
        const available = formatsFor(next.account_id, value);
        next.format = available[0] || '';
      }
      return next;
    });
  }

  function onFirstLegAmountChange(value: string) {
    setP2UserEdited(false);
    if (firstLegKind === 'out') {
      setOutLeg((prev) => ({ ...prev, amount: value }));
    } else {
      setInLeg((prev) => ({ ...prev, amount: value }));
    }
  }

  function onSecondLegAmountChange(value: string) {
    setP2UserEdited(true);
    if (secondLegKind === 'out') {
      setOutLeg((prev) => ({ ...prev, amount: value }));
    } else {
      setInLeg((prev) => ({ ...prev, amount: value }));
    }
  }

  function updateFeeAccount(nextAccountId: string) {
    setP2UserEdited(false);
    setFeeAccountId(nextAccountId);
    const availableCurrencies = acCache[nextAccountId] || [];
    if (!availableCurrencies.some((c) => c.currency_id === feeCurrencyId)) {
      setFeeCurrencyId('');
      setFeeFormat('');
    }
  }

  function updateFeeCurrency(nextCurrencyId: string) {
    setP2UserEdited(false);
    setFeeCurrencyId(nextCurrencyId);
    let availableFormats: ('' | 'CASH' | 'DIGITAL')[] = [];
    if (nextCurrencyId === outLeg.currency_id) availableFormats = formatsFor(outLeg.account_id, nextCurrencyId);
    else if (nextCurrencyId === inLeg.currency_id) availableFormats = formatsFor(inLeg.account_id, nextCurrencyId);
    else availableFormats = formatsFor(feeAccountId, nextCurrencyId);
    setFeeFormat(availableFormats[0] || '');
  }

  /** Divisa de comisión vacía + comisión activa: default = primera pata (no pisar borrador ni valor ya elegido). */
  useEffect(() => {
    if (!feeEnabled || feeCurrencyId !== '') return;
    const cid = firstLegKind === 'out' ? outLeg.currency_id : inLeg.currency_id;
    if (!cid) return;
    if (!feeLegCurrencyOptions.some((c) => c.currency_id === cid)) return;
    setFeeCurrencyId(cid);
    let availableFormats: Array<'CASH' | 'DIGITAL'> = [];
    if (cid === outLeg.currency_id && outLeg.account_id) {
      availableFormats = allowedFormatsFromList(acCache[outLeg.account_id] || [], cid);
    } else if (cid === inLeg.currency_id && inLeg.account_id) {
      availableFormats = allowedFormatsFromList(acCache[inLeg.account_id] || [], cid);
    } else if (feeAccountId) {
      availableFormats = allowedFormatsFromList(acCache[feeAccountId] || [], cid);
    }
    setFeeFormat(availableFormats[0] || '');
  }, [
    feeEnabled,
    feeCurrencyId,
    firstLegKind,
    outLeg.currency_id,
    outLeg.account_id,
    inLeg.currency_id,
    inLeg.account_id,
    feeAccountId,
    feeLegCurrencyOptions,
    acCache,
  ]);

  function buildDraftData(): TransferenciaDraftData {
    const base: TransferenciaDraftData = {
      out_leg: outLeg,
      in_leg: inLeg,
      feeEnabled,
      feeMode,
      feeValue,
      feeTreatment,
      feePayer,
      feeSettlement,
      feeCurrencyId,
      feeAccountId,
      feeFormat,
    };
    if (needsFxQuote && quoteRate.trim()) {
      base.quote = {
        rate: quoteRate.trim(),
        mode: normalizeQuoteMode(quoteMode),
        currency_id: fxFunctionalCurrencyId || undefined,
      };
    }
    return base;
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'TRANSFERENCIA', buildDraftData());
      try {
        localStorage.setItem(localDraftKey, JSON.stringify(buildDraftData()));
      } catch {
        // non-blocking
      }
      setDraftMessage('Borrador guardado.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo guardar el borrador.';
      if (String(msg).includes('BORRADOR')) {
        setError('La operación ya no está en BORRADOR. Reanudá un borrador válido o creá una nueva operación.');
        return;
      }
      setError(msg);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleSubmit() {
    setError('');
    if (!outLeg.account_id || !outLeg.currency_id || !outLeg.amount.trim()) {
      setError('Completá la pata de salida.');
      return;
    }
    if (!inLeg.account_id || !inLeg.currency_id || !inLeg.amount.trim()) {
      setError('Completá la pata de entrada.');
      return;
    }
    if (!outLeg.format) {
      setError('Seleccioná el formato de la pata de salida.');
      return;
    }
    if (!inLeg.format) {
      setError('Seleccioná el formato de la pata de entrada.');
      return;
    }
    if (!Number.isFinite(outAmount) || outAmount <= 0 || !Number.isFinite(inAmount) || inAmount <= 0) {
      setError('Los montos de entrada/salida deben ser mayores a 0.');
      return;
    }
    if (outLeg.account_id === inLeg.account_id && outLeg.currency_id === inLeg.currency_id && outLeg.format === inLeg.format) {
      setError('Salida y entrada no pueden ser iguales.');
      return;
    }
    if (feeEnabled && feeTreatment === 'INCLUIDA' && feeSettlement === 'PENDIENTE') {
      setError('Con comisión incluida no se permite comisión pendiente.');
      return;
    }
    if (feeEnabled && feeTreatment === 'INCLUIDA' && includedNetAmount <= 0) {
      setError('Con comisión incluida, el neto debe ser mayor a 0.');
      return;
    }
    if (needsFxQuote) {
      const r = parseFloat(quoteRate.replace(',', '.'));
      if (!Number.isFinite(r) || r <= 0) {
        setError('Completá la cotización (tasa > 0) para el cruce de divisas.');
        return;
      }
    }
    if (feeEnabled && !feeAccountDerivesFromLeg && !feeAccountId.trim()) {
      setError('Seleccioná la cuenta de comisión (la divisa de comisión no coincide con ninguna pata).');
      return;
    }
    if (feeEnabled && !feeCurrencyId) {
      setError('Seleccioná la divisa de comisión.');
      return;
    }
    if (feeEnabled && !feeFormat) {
      setError('Seleccioná el formato de comisión.');
      return;
    }
    if (feeEnabled && feeMode === 'PERCENT' && feeCurrencyId !== outLeg.currency_id && feeCurrencyId !== inLeg.currency_id) {
      setError('La comisión porcentual debe usar la divisa de una de las dos patas.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        out_leg: {
          account_id: outLeg.account_id,
          currency_id: outLeg.currency_id,
          format: outLeg.format,
          amount: numberToNormalizedMoney(parseFloat(outLeg.amount), 2),
          settlement: outLeg.settlement,
        },
        in_leg: {
          account_id: inLeg.account_id,
          currency_id: inLeg.currency_id,
          format: inLeg.format,
          amount: numberToNormalizedMoney(parseFloat(inLeg.amount), 2),
          settlement: inLeg.settlement,
        },
        fee: {
          enabled: feeEnabled,
          mode: feeMode,
          value: feeEnabled && feeValue ? numberToNormalizedMoney(parseFloat(feeValue), feeMode === 'PERCENT' ? 4 : 2) : '0',
          treatment: feeTreatment,
          payer: feePayer,
          settlement: feeSettlement,
          currency_id: feeCurrencyId,
          account_id: feeAccountId,
          format: feeFormat,
          // Compatibilidad controlada con backend legacy.
          sign: feeTreatment === 'INCLUIDA' ? 'MINUS' : 'PLUS',
        },
      };
      if (needsFxQuote && quoteRate.trim()) {
        payload.quote = {
          rate: quoteRate.trim().replace(',', '.'),
          currency_id: fxFunctionalCurrencyId || '',
          mode: normalizeQuoteMode(quoteMode),
        };
      }
      await api.post(`/movements/${movementId}/transferencia`, payload);
      try {
        localStorage.removeItem(localDraftKey);
      } catch {
        // noop
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar la transferencia.');
      return;
    } finally {
      setSubmitting(false);
    }
    onDone();
  }

  function handleClear() {
    setError('');
    setOutLeg(emptyLeg());
    setInLeg(emptyLeg());
    setFeeEnabled(false);
    setFeeMode('PERCENT');
    setFeeValue('');
    setFeeTreatment('APARTE');
    setFeePayer('CLIENTE_PAGA');
    setFeeSettlement('REAL');
    setFeeCurrencyId('');
    setFeeAccountId('');
    setFeeFormat('');
    setQuoteRate('');
    setQuoteMode('MULTIPLY');
    setFirstLegDirection('SALIDA');
    setP2UserEdited(false);
    setCalcBruto('');
    setCalcFeeMode('PERCENT');
    setCalcFeeValue('');
    setCalcClipboardErr(null);
    try {
      localStorage.removeItem(localDraftKey);
    } catch {
      // noop
    }
  }

  function renderLegFieldset(kind: 'out' | 'in', position: 'first' | 'second') {
    const leg = kind === 'out' ? outLeg : inLeg;
    const acList = kind === 'out' ? outAC : inAC;
    const legend = kind === 'out' ? 'Salida — lo que entregamos' : 'Ingreso — lo que recibimos';
    const help = kind === 'out' ? 'Salida: dinero que sale de nuestras cuentas.' : 'Ingreso: dinero que entra a nuestras cuentas.';
    const onAmount = position === 'first' ? onFirstLegAmountChange : onSecondLegAmountChange;
    const amountLabel = kind === 'out' ? 'Monto salida' : 'Monto entrada';
    const amountHint = position === 'second' ? secondLegSuggestHint || secondLegActiveSuggestHint : undefined;

    return (
      <fieldset key={`${kind}-${position}`}>
        <legend className="text-sm font-semibold text-fg mb-2">{legend}</legend>
        <p className="text-xs text-fg-muted mb-2">{help}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
            <select
              value={leg.account_id}
              onChange={(e) => updateLeg(kind, 'account_id', e.target.value)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
            <select
              value={leg.currency_id}
              onChange={(e) => updateLeg(kind, 'currency_id', e.target.value)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {acList.map((ac) => (
                <option key={ac.currency_id} value={ac.currency_id}>
                  {ac.currency_code}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
            <select
              value={leg.format}
              onChange={(e) => updateLeg(kind, 'format', e.target.value as '' | 'CASH' | 'DIGITAL')}
              disabled={!leg.account_id || !leg.currency_id}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm disabled:bg-surface"
            >
              <option value="">—</option>
              {formatsFor(leg.account_id, leg.currency_id).map((f) => (
                <option key={f} value={f}>
                  {formatLabel(f)}
                </option>
              ))}
            </select>
            {leg.account_id && leg.currency_id && formatsFor(leg.account_id, leg.currency_id).length === 0 && (
              <p className="mt-1 text-[11px] text-fg-muted">No hay formato habilitado para esta cuenta/divisa.</p>
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <MoneyInput label={amountLabel} value={leg.amount} onValueChange={onAmount} placeholder={kind === 'out' ? 'Ej: 10000' : 'Ej: 10200'} />
            {amountHint ? <p className="text-xs text-fg-muted mt-1">{amountHint}</p> : null}
          </div>
        </div>
        {position === 'second' && needsFxQuote ? (
          <div className="mt-3 pt-3 border-t border-subtle space-y-2 min-w-0">
            <p className="text-xs font-medium text-fg-muted">Cotización (cruce)</p>
            <p className="text-[11px] text-fg-muted leading-snug">
              Moneda funcional FX en una pata; el monto de esta pata se sugiere desde la primera. Si lo editás, se respeta (validación en servidor).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <MoneyInput
                label="Tipo de cambio"
                value={quoteRate}
                onValueChange={(v) => {
                  setQuoteRate(v);
                  setP2UserEdited(false);
                }}
                fractionDigits={6}
              />
              <div>
                <label className="block text-[11px] text-fg-muted mb-0.5">Modo</label>
                <select
                  value={quoteMode}
                  onChange={(e) => {
                    setQuoteMode(normalizeQuoteMode(e.target.value));
                    setP2UserEdited(false);
                  }}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-xs"
                >
                  <option value="MULTIPLY">Multiplicar</option>
                  <option value="DIVIDE">Dividir</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}
        <label className="mt-2 flex items-center gap-2 text-sm text-fg cursor-pointer select-none">
          <input
            type="checkbox"
            checked={leg.settlement === 'PENDIENTE'}
            onChange={(e) => updateLeg(kind, 'settlement', e.target.checked ? 'PENDIENTE' : 'REAL')}
          />
          Dejar como pendiente
        </label>
      </fieldset>
    );
  }

  const impactoCcCierre = impactoClienteCcCierre(clientCcEnabled, feeEnabled, feeTreatment, feePayer);

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-error text-sm">{error}</p>}
      <ApiErrorBanner message={currenciesLoadError} />
      {draftMessage && <p className="text-info text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-fg-muted text-sm">Cargando borrador...</p>}

      <p className="rounded-md border border-subtle bg-brand-soft px-3 py-2 text-xs text-fg">
        Elegí si cargás primero <strong>salida</strong> o <strong>ingreso</strong>; el envío al servidor sigue usando siempre{' '}
        <span className="font-mono">out_leg</span> / <span className="font-mono">in_leg</span>. REAL/PENDIENTE y CC siguen las reglas del tipo de operación.
      </p>

      <div className="border border-subtle rounded-lg p-3 bg-surface space-y-2">
        <p className="text-sm font-semibold text-fg">Primera pata a cargar</p>
        <div className="flex flex-wrap gap-3 text-sm text-fg">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="first-leg-dir"
              checked={firstLegDirection === 'SALIDA'}
              onChange={() => {
                setFirstLegDirection('SALIDA');
                setP2UserEdited(false);
              }}
            />
            Salida
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="radio"
              name="first-leg-dir"
              checked={firstLegDirection === 'INGRESO'}
              onChange={() => {
                setFirstLegDirection('INGRESO');
                setP2UserEdited(false);
              }}
            />
            Ingreso
          </label>
        </div>
      </div>

      {renderLegFieldset(firstLegKind, 'first')}

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Comisionado</legend>
        <div
          className="mb-3 p-2 rounded hover:bg-surface cursor-pointer inline-flex items-center gap-2"
          onClick={() => {
            setFeeEnabled((p) => !p);
            setP2UserEdited(false);
          }}
        >
          <input
            type="checkbox"
            checked={feeEnabled}
            onChange={(e) => {
              setFeeEnabled(e.target.checked);
              setP2UserEdited(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-fg text-sm">Tiene comisión</span>
        </div>
        {feeEnabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Tipo</label>
                <select
                  value={feeMode}
                  onChange={(e) => {
                    setFeeMode(e.target.value as 'PERCENT' | 'FIXED');
                    setP2UserEdited(false);
                  }}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                >
                  <option value="PERCENT">Porcentaje (%)</option>
                  <option value="FIXED">Monto fijo</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Tratamiento</label>
                <select
                  value={feeTreatment}
                  onChange={(e) => {
                    setFeeTreatment(e.target.value as 'APARTE' | 'INCLUIDA');
                    setP2UserEdited(false);
                  }}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                >
                  <option value="APARTE">Aparte (+)</option>
                  <option value="INCLUIDA">Incluida (-)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Quién paga</label>
                <select
                  value={feePayer}
                  onChange={(e) => setFeePayer(e.target.value as 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS')}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                >
                  <option value="CLIENTE_PAGA">Cliente paga</option>
                  <option value="NOSOTROS_PAGAMOS">Nosotros pagamos</option>
                </select>
              </div>
              {!feeAccountDerivesFromLeg ? (
                <div>
                  <label className="block text-xs text-fg-muted mb-0.5">Cuenta comisión</label>
                  <select value={feeAccountId} onChange={(e) => updateFeeAccount(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-xs text-fg-muted sm:col-span-1 lg:col-span-1 self-end pb-1">
                  Cuenta y formato de comisión: misma pata que la divisa de comisión.
                </p>
              )}
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Divisa comisión</label>
                <select
                  value={feeCurrencyId}
                  onChange={(e) => updateFeeCurrency(e.target.value)}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                  disabled={feeLegCurrencyOptions.length === 0}
                >
                  <option value="">—</option>
                  {feeLegCurrencyOptions.map((ac) => (
                    <option key={ac.currency_id} value={ac.currency_id}>
                      {ac.currency_code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Formato comisión</label>
                <select
                  value={feeFormat}
                  onChange={(e) => {
                    setFeeFormat(e.target.value as '' | 'CASH' | 'DIGITAL');
                    setP2UserEdited(false);
                  }}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm disabled:bg-surface"
                  disabled={(!feeAccountId && !feeAccountDerivesFromLeg) || !feeCurrencyId || feeAccountDerivesFromLeg}
                >
                  <option value="">—</option>
                  {(feeAccountDerivesFromLeg
                    ? feeCurrencyId === outLeg.currency_id
                      ? formatsFor(outLeg.account_id, feeCurrencyId)
                      : formatsFor(inLeg.account_id, feeCurrencyId)
                    : formatsFor(feeAccountId, feeCurrencyId)
                  ).map((f) => (
                    <option key={f} value={f}>
                      {formatLabel(f)}
                    </option>
                  ))}
                </select>
                {!feeAccountDerivesFromLeg && feeAccountId && feeCurrencyId && formatsFor(feeAccountId, feeCurrencyId).length === 0 && (
                  <p className="mt-1 text-[11px] text-fg-muted">No hay formato habilitado para esta cuenta/divisa.</p>
                )}
              </div>
              <label className="sm:col-span-2 lg:col-span-2 flex items-end pb-2 text-sm text-fg cursor-pointer select-none gap-2">
                <input
                  type="checkbox"
                  checked={feeSettlement === 'PENDIENTE'}
                  onChange={(e) => {
                    setFeeSettlement(e.target.checked ? 'PENDIENTE' : 'REAL');
                    setP2UserEdited(false);
                  }}
                  disabled={feeTreatment === 'INCLUIDA'}
                />
                Comisión pendiente
              </label>
              {feeTreatment === 'INCLUIDA' && (
                <p className="sm:col-span-2 lg:col-span-2 mt-1 text-[11px] text-fg-muted">Con incluida no aplica pendiente de comisión.</p>
              )}
              <MoneyInput
                label={feeMode === 'PERCENT' ? 'Porcentaje' : 'Monto fijo'}
                value={feeValue}
                onValueChange={(v) => {
                  setFeeValue(v);
                  setP2UserEdited(false);
                }}
                fractionDigits={feeMode === 'PERCENT' ? 4 : 2}
              />
              <div className="flex items-end">
                {expectedFee > 0 && (
                  <p className="text-sm font-mono text-fg-muted">
                    Comisión:{' '}
                    <span className="font-medium">
                      {feeCurrCode} {formatMoneyAR(expectedFee)}
                    </span>
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs text-fg-muted border border-subtle rounded-lg p-3 bg-surface">{feeComisionadoText}</p>
          </div>
        )}
      </fieldset>

      {renderLegFieldset(secondLegKind, 'second')}

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Impacto cliente</legend>
        <div className="bg-surface rounded p-3 text-sm space-y-1.5">
          <p className="text-xs text-fg-muted">
            Solo lo <strong className="font-medium text-fg-muted">REAL</strong> impacta caja y CC ahora; lo pendiente es obligación abierta (detalle en &quot;Criterios contables&quot;).
          </p>
          <div className="grid grid-cols-2 gap-x-2 sm:gap-x-4 gap-y-1 font-mono text-fg text-xs sm:text-sm [&>span]:min-w-0 [&>span]:break-words">
            <span>Salida:</span>
            <span>
              {outCurrCode} {formatMoneyAR(outAbs)} ({settlementLabel(outLeg.settlement)})
            </span>
            <span>Entrada:</span>
            <span>
              {inCurrCode} {formatMoneyAR(inAbs)} ({settlementLabel(inLeg.settlement)})
            </span>
            <span>Pendiente salida:</span>
            <span>{outPendingLabel}</span>
            <span>Pendiente entrada:</span>
            <span>{inPendingLabel}</span>
            {feeEnabled && expectedFee > 0 && (
              <>
                <span>{feeTreatment === 'APARTE' ? 'Comisión (aparte):' : 'Comisión (incluida en patas):'}</span>
                <span>
                  {feeCurrCode} {formatMoneyAR(expectedFee)}
                </span>
              </>
            )}
            {feeEnabled && feeTreatment === 'INCLUIDA' && (
              <>
                <span>Neto salida (incluida):</span>
                <span>
                  {outCurrCode} {formatMoneyAR(includedNetAmount)}
                </span>
              </>
            )}
            <span className="border-t border-subtle pt-1 font-semibold">Impacto comercial (CC):</span>
            <span className="border-t border-subtle pt-1 font-semibold">
              {!clientCcEnabled ? 'No aplica (cliente sin CC habilitada)' : feeEnabled ? feeComisionadoText : 'Sin comisión'}
            </span>
            <span>Impacto real ahora:</span>
            <span>Solo patas/commission en REAL</span>
            <span>Pendiente operativo:</span>
            <span>Solo patas/commission en PENDIENTE</span>
            <span>Liquidación comisión:</span>
            <span>
              {feeEnabled ? settlementLabel(feeSettlement === 'REAL' || feeTreatment === 'INCLUIDA' ? 'REAL' : 'PENDIENTE') : 'N/A'}
            </span>
            <span>Tipo pendiente comisión:</span>
            <span>
              {feeEnabled && feeSettlement === 'PENDIENTE' && feeTreatment === 'APARTE'
                ? feePayer === 'CLIENTE_PAGA'
                  ? 'PENDIENTE_DE_COBRO_COMISION'
                  : 'PENDIENTE_DE_PAGO_COMISION'
                : 'N/A'}
            </span>
          </div>
          {feeEnabled && feeTreatment === 'INCLUIDA' && includedNetAmount <= 0 && (
            <p className="text-error text-xs mt-1">Con comisión incluida, el neto debe ser mayor a 0.</p>
          )}
          {impactoCcCierre ? <p className="text-xs text-fg-muted border-t border-subtle pt-2 mt-2">{impactoCcCierre}</p> : null}
          <details className="border-t border-subtle pt-2 mt-2">
            <summary className="cursor-pointer text-xs font-medium text-fg-muted list-none hover:text-fg [&::-webkit-details-marker]:hidden">
              Criterios contables (solo transferencia)
            </summary>
            <ul className="mt-2 space-y-1.5 text-[11px] text-fg-muted list-disc pl-4 leading-snug">
              <li>
                <strong className="font-medium text-fg-muted">Incluida:</strong> el backend no parte el bruto; se persisten solo las patas. La ayuda desplegable &quot;Ayuda: comisión incluida&quot; solo calcula; no escribe el movimiento.
              </li>
              <li>
                <strong className="font-medium text-fg-muted">Pendiente:</strong> esa pata no suma al CC real hasta resolverla; queda pendiente operativo.
              </li>
              <li>
                <strong className="font-medium text-fg-muted">Utilidad compra-venta</strong> (Inicio / reportes): no viene de transferencias; la mesa se registra en COMPRA o VENTA.
              </li>
              <li>
                <strong className="font-medium text-fg-muted">Dos divisas:</strong> sin cotización automática entre patas; el segundo monto debe ser coherente con el pacto.
              </li>
            </ul>
          </details>
        </div>
      </fieldset>

      {!calcHelpActive ? (
        <div className="border border-subtle rounded-lg p-3 bg-surface opacity-60 pointer-events-none min-w-0">
          <p className="text-xs text-fg-muted">Ayuda disponible solo con comisión activa y tratamiento Incluida.</p>
        </div>
      ) : (
        <details className="border border-subtle rounded-lg p-3 bg-surface min-w-0">
          <summary className="cursor-pointer text-sm font-semibold text-fg list-none [&::-webkit-details-marker]:hidden">
            Ayuda: comisión incluida (no registra movimientos)
          </summary>
          <div className="mt-3 space-y-3 text-xs text-fg-muted">
            <p>
              Lo que se ejecuta y va al backend es lo que cargás en las patas. Esta sección solo calcula. Con comisión Incluida, el sistema no parte solo un bruto en neto+fee al guardar (igual que hoy).
            </p>
            <p>
              El neto contable que importa es el que figura en <strong className="text-fg">Impacto cliente</strong> una vez que cargás las patas (fila «Neto salida (incluida)»); esta ayuda solo sirve para pensar el bruto/comisión antes de cargar.
            </p>

            {calcDerived.helpAlert ? (
              <p role="alert" className="text-error text-sm">
                {calcDerived.helpAlert}
              </p>
            ) : null}
            {calcClipboardErr ? (
              <p role="alert" className="text-error text-sm">
                {calcClipboardErr}
              </p>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="calc-bruto" className="block text-fg-muted mb-0.5">
                  Bruto operativo (ayuda)
                </label>
                <input
                  id="calc-bruto"
                  type="text"
                  inputMode="decimal"
                  value={calcBruto}
                  onChange={(e) => setCalcBruto(e.target.value)}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm text-fg bg-app"
                />
              </div>
              <div>
                <label htmlFor="calc-fee-mode" className="block text-fg-muted mb-0.5">
                  Comisión en ayuda
                </label>
                <select
                  id="calc-fee-mode"
                  value={calcFeeMode}
                  onChange={(e) => setCalcFeeMode(e.target.value as 'PERCENT' | 'FIXED')}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm text-fg bg-app"
                >
                  <option value="PERCENT">Porcentaje (%)</option>
                  <option value="FIXED">Monto fijo</option>
                </select>
                <p className="mt-1 text-[11px] text-fg-muted">El % se calcula sobre el bruto ingresado en esta ayuda.</p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="calc-fee-val" className="block text-fg-muted mb-0.5">
                  {calcFeeMode === 'PERCENT' ? 'Porcentaje' : 'Monto fijo'}
                </label>
                <input
                  id="calc-fee-val"
                  type="text"
                  inputMode="decimal"
                  value={calcFeeValue}
                  onChange={(e) => setCalcFeeValue(e.target.value)}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm text-fg bg-app"
                />
              </div>
            </div>

            {(() => {
              const feeC = calcDerived.feeCalc;
              const netoC = calcDerived.netoCalc;
              const brutoC = calcDerived.bruto;
              if (!calcDerived.showNumeric || feeC == null || netoC == null || brutoC == null) return null;
              return (
                <div className="space-y-2 font-mono text-sm text-fg">
                  <p>Comisión calculada (ayuda): {formatMoneyAR(feeC)}</p>
                  <p>Neto sugerido (ayuda): {formatMoneyAR(netoC)}</p>
                  <p>
                    Check: {formatMoneyAR(netoC)} + {formatMoneyAR(feeC)} = {formatMoneyAR(brutoC)}
                  </p>
                  {calcDerived.roundWarning ? <p className="text-fg-muted font-sans text-xs">{calcDerived.roundWarning}</p> : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      className="rounded border border-subtle px-2 py-1 text-xs text-fg hover:bg-overlay-hover"
                      onClick={() => void copyCalcPlainToClipboard(netoC)}
                    >
                      Copiar neto sugerido
                    </button>
                    <button
                      type="button"
                      className="rounded border border-subtle px-2 py-1 text-xs text-fg hover:bg-overlay-hover"
                      onClick={() => void copyCalcPlainToClipboard(feeC)}
                    >
                      Copiar comisión calculada
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </details>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Totales</legend>
        <div className="bg-surface rounded p-3 text-sm">
          <p className="text-xs text-fg-muted mb-2">
            Comisión pendiente: el importe figura en Pendiente; Real ahora solo incluye comisión liquidada al momento. CC refleja el
            impacto comercial independientemente de la liquidación.
          </p>
          <p className="text-xs text-fg-muted mb-2">CC negativo = más deuda del cliente en esa moneda.</p>
          {totalsByCurrency.length === 0 ? (
            <p className="text-fg-muted text-xs">Completá datos para ver totales.</p>
          ) : (
            <div className="space-y-2">
              {totalsByCurrency.map((row) => (
                <div key={row.code} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-fg text-xs sm:text-sm [&>span]:min-w-0 [&>span]:break-words">
                  <span className="font-semibold">{row.code}</span>
                  <span>CC: {clientCcEnabled ? formatMoneyAR(row.cc) : '—'}</span>
                  <span>Real ahora: {formatMoneyAR(row.real)}</span>
                  <span>Pendiente: {formatMoneyAR(row.pending)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      <OperationFormActions
        onSubmit={handleSubmit}
        onSaveDraft={handleSaveDraft}
        onClear={handleClear}
        onCancel={onCancel}
        submitting={submitting}
        savingDraft={savingDraft}
        draftLoading={draftLoading}
      />
    </div>
  );
}
