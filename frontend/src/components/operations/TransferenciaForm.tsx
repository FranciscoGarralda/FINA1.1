import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import ApiErrorBanner from '../common/ApiErrorBanner';
import { formatMoneyAR, numberToNormalizedMoney, roundTo } from '../../utils/money';
import { saveOperationDraft } from '../../utils/operationDrafts';
import { allowedFormatsFromList, formatLabel } from '../../utils/accountCurrencyFormats';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';
import OperationFormActions from './OperationFormActions';

interface AccountCurrency { currency_id: string; currency_code: string; cash_enabled: boolean; digital_enabled: boolean; }

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
    return {
      out_leg: { ...emptyLeg(), ...anyDraft.out_leg },
      in_leg: { ...emptyLeg(), ...anyDraft.in_leg },
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

export default function TransferenciaForm({ movementId, clientId: _clientId, clientCcEnabled, onDone, onCancel }: Props) {
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

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [currenciesLoadError, setCurrenciesLoadError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [amountMirror, setAmountMirror] = useState<{ outManual: boolean; inManual: boolean }>({
    outManual: false,
    inManual: false,
  });

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
      setAmountMirror({
        outManual: mapped.out_leg.amount.trim() !== '',
        inManual: mapped.in_leg.amount.trim() !== '',
      });
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

    api.get<DraftApiResponse<TransferenciaDraftData | LegacyTransferenciaDraftData>>(`/movements/${movementId}/draft`)
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
          // non-blocking local cache
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

  const outAmount = useMemo(() => parseFloat(outLeg.amount), [outLeg.amount]);
  const inAmount = useMemo(() => parseFloat(inLeg.amount), [inLeg.amount]);
  const outAbs = useMemo(() => roundTo(Math.abs(outAmount || 0), 2), [outAmount]);
  const inAbs = useMemo(() => roundTo(Math.abs(inAmount || 0), 2), [inAmount]);

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

  const outPendingLabel = outLeg.settlement === 'PENDIENTE' ? 'Sí' : 'No';
  const inPendingLabel = inLeg.settlement === 'PENDIENTE' ? 'Sí' : 'No';
  const feeImpactLabel = feePayer === 'CLIENTE_PAGA' ? 'Comisión en contra del cliente' : 'Comisión a favor del cliente';
  const feeCurrencyOptions = feeAccountId ? (acCache[feeAccountId] || []) : [];
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
      add(outLeg.currency_id, outCurrCode, 'cc', -outAbs);
      add(inLeg.currency_id, inCurrCode, 'cc', inAbs);
    }

    add(outLeg.currency_id, outCurrCode, 'real', outLeg.settlement === 'REAL' ? -outAbs : 0);
    add(inLeg.currency_id, inCurrCode, 'real', inLeg.settlement === 'REAL' ? inAbs : 0);

    add(outLeg.currency_id, outCurrCode, 'pending', outLeg.settlement === 'PENDIENTE' ? -outAbs : 0);
    add(inLeg.currency_id, inCurrCode, 'pending', inLeg.settlement === 'PENDIENTE' ? inAbs : 0);

    if (feeEnabled && expectedFee > 0 && feeCurrCode) {
      if (clientCcEnabled) {
        add(feeCurrencyId, feeCurrCode, 'cc', feeAmountSigned);
      }
      add(feeCurrencyId, feeCurrCode, 'real', feeRealSigned);
      add(feeCurrencyId, feeCurrCode, 'pending', feePendingSigned);
    }

    return Object.values(totals);
  }, [
    clientCcEnabled,
    outLeg.currency_id, outCurrCode, outAbs, outLeg.settlement,
    inLeg.currency_id, inCurrCode, inAbs, inLeg.settlement,
    feeEnabled, expectedFee, feeCurrCode, feeCurrencyId, feeAmountSigned, feeRealSigned, feePendingSigned,
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

  function handleOutAmountChange(value: string) {
    const outEmpty = value.trim() === '';
    const inCurrentEmpty = inLeg.amount.trim() === '';
    const shouldMirrorToIn = inCurrentEmpty || !amountMirror.inManual;

    setOutLeg((prev) => ({ ...prev, amount: value }));
    if (shouldMirrorToIn) {
      setInLeg((prev) => ({ ...prev, amount: value }));
    }
    setAmountMirror((prev) => ({
      outManual: !outEmpty,
      inManual: shouldMirrorToIn ? false : prev.inManual,
    }));
  }

  function handleInAmountChange(value: string) {
    const inEmpty = value.trim() === '';
    const outCurrentEmpty = outLeg.amount.trim() === '';
    const shouldMirrorToOut = outCurrentEmpty || !amountMirror.outManual;

    setInLeg((prev) => ({ ...prev, amount: value }));
    if (shouldMirrorToOut) {
      setOutLeg((prev) => ({ ...prev, amount: value }));
    }
    setAmountMirror((prev) => ({
      inManual: !inEmpty,
      outManual: shouldMirrorToOut ? false : prev.outManual,
    }));
  }

  function updateFeeAccount(nextAccountId: string) {
    setFeeAccountId(nextAccountId);
    const availableCurrencies = acCache[nextAccountId] || [];
    if (!availableCurrencies.some((c) => c.currency_id === feeCurrencyId)) {
      setFeeCurrencyId('');
      setFeeFormat('');
    }
  }

  function updateFeeCurrency(nextCurrencyId: string) {
    setFeeCurrencyId(nextCurrencyId);
    const availableFormats = formatsFor(feeAccountId, nextCurrencyId);
    setFeeFormat(availableFormats[0] || '');
  }

  function buildDraftData(): TransferenciaDraftData {
    return { out_leg: outLeg, in_leg: inLeg, feeEnabled, feeMode, feeValue, feeTreatment, feePayer, feeSettlement, feeCurrencyId, feeAccountId, feeFormat };
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
        // non-blocking local cache
      }
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      const msg = err?.message || 'No se pudo guardar el borrador.';
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
    if (feeEnabled && !feeAccountId) {
      setError('Seleccioná la cuenta de comisión.');
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
      await api.post(`/movements/${movementId}/transferencia`, {
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
      });
      try {
        localStorage.removeItem(localDraftKey);
      } catch {
        // noop
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar la transferencia.');
    } finally {
      setSubmitting(false);
    }
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
    setAmountMirror({ outManual: false, inManual: false });
    try {
      localStorage.removeItem(localDraftKey);
    } catch {
      // noop
    }
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="text-green-700 font-medium mb-4">Transferencia registrada correctamente.</p>
        <button type="button" onClick={onDone} className="btn-touch bg-green-600 text-white rounded-md hover:bg-green-700 transition">
          Ver movimiento
        </button>
      </div>
    );
  }

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <ApiErrorBanner message={currenciesLoadError} />
      {draftMessage && <p className="text-blue-600 text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-gray-500 text-sm">Cargando borrador...</p>}

      <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        Liquidación palo a palo: cargá el monto de <strong>salida</strong> y el de <strong>ingreso</strong> en cada divisa acordada; no es obligatorio usar cotización del sistema. REAL/PENDIENTE y CC siguen las reglas del tipo de operación.
      </p>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Transferencia salida (lo que entregamos)</legend>
        <p className="text-xs text-gray-500 mb-2">Salida: dinero que sale de nuestras cuentas.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta</label>
            <select value={outLeg.account_id} onChange={(e) => updateLeg('out', 'account_id', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={outLeg.currency_id} onChange={(e) => updateLeg('out', 'currency_id', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {outAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={outLeg.format}
              onChange={(e) => updateLeg('out', 'format', e.target.value as '' | 'CASH' | 'DIGITAL')}
              disabled={!outLeg.account_id || !outLeg.currency_id}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-100"
            >
              <option value="">—</option>
              {formatsFor(outLeg.account_id, outLeg.currency_id).map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
            {outLeg.account_id && outLeg.currency_id && formatsFor(outLeg.account_id, outLeg.currency_id).length === 0 && (
              <p className="mt-1 text-[11px] text-gray-500">No hay formato habilitado para esta cuenta/divisa.</p>
            )}
          </div>
          <MoneyInput
            label="Monto salida"
            value={outLeg.amount}
            onValueChange={handleOutAmountChange}
            placeholder="Ej: 10000"
          />
          <label className="flex items-end pb-2 text-sm text-gray-700 cursor-pointer select-none gap-2">
            <input
              type="checkbox"
              checked={outLeg.settlement === 'PENDIENTE'}
              onChange={(e) => updateLeg('out', 'settlement', e.target.checked ? 'PENDIENTE' : 'REAL')}
            />
            Dejar como pendiente
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Transferencia ingreso (lo que recibimos)</legend>
        <p className="text-xs text-gray-500 mb-2">Ingreso: dinero que entra a nuestras cuentas.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta</label>
            <select value={inLeg.account_id} onChange={(e) => updateLeg('in', 'account_id', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={inLeg.currency_id} onChange={(e) => updateLeg('in', 'currency_id', e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {inAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={inLeg.format}
              onChange={(e) => updateLeg('in', 'format', e.target.value as '' | 'CASH' | 'DIGITAL')}
              disabled={!inLeg.account_id || !inLeg.currency_id}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-100"
            >
              <option value="">—</option>
              {formatsFor(inLeg.account_id, inLeg.currency_id).map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
            {inLeg.account_id && inLeg.currency_id && formatsFor(inLeg.account_id, inLeg.currency_id).length === 0 && (
              <p className="mt-1 text-[11px] text-gray-500">No hay formato habilitado para esta cuenta/divisa.</p>
            )}
          </div>
          <MoneyInput
            label="Monto entrada"
            value={inLeg.amount}
            onValueChange={handleInAmountChange}
            placeholder="Ej: 10200"
          />
          <label className="flex items-end pb-2 text-sm text-gray-700 cursor-pointer select-none gap-2">
            <input
              type="checkbox"
              checked={inLeg.settlement === 'PENDIENTE'}
              onChange={(e) => updateLeg('in', 'settlement', e.target.checked ? 'PENDIENTE' : 'REAL')}
            />
            Dejar como pendiente
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Comisión</legend>
        <div
          className="mb-3 p-2 rounded hover:bg-gray-50 cursor-pointer inline-flex items-center gap-2"
          onClick={() => setFeeEnabled((p) => !p)}
        >
          <input
            type="checkbox"
            checked={feeEnabled}
            onChange={(e) => setFeeEnabled(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-gray-700 text-sm">Tiene comisión</span>
        </div>
        {feeEnabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Tipo</label>
              <select value={feeMode} onChange={(e) => setFeeMode(e.target.value as 'PERCENT' | 'FIXED')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="PERCENT">Porcentaje (%)</option>
                <option value="FIXED">Monto fijo</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Tratamiento</label>
              <select value={feeTreatment} onChange={(e) => setFeeTreatment(e.target.value as 'APARTE' | 'INCLUIDA')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="APARTE">Aparte (+)</option>
                <option value="INCLUIDA">Incluida (-)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Quién paga</label>
              <select value={feePayer} onChange={(e) => setFeePayer(e.target.value as 'CLIENTE_PAGA' | 'NOSOTROS_PAGAMOS')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="CLIENTE_PAGA">Cliente paga</option>
                <option value="NOSOTROS_PAGAMOS">Nosotros pagamos</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Cuenta comisión</label>
              <select value={feeAccountId} onChange={(e) => updateFeeAccount(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Divisa comisión</label>
              <select value={feeCurrencyId} onChange={(e) => updateFeeCurrency(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm" disabled={!feeAccountId}>
                <option value="">—</option>
                {feeCurrencyOptions.map((ac) => (
                  <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Formato comisión</label>
              <select value={feeFormat} onChange={(e) => setFeeFormat(e.target.value as '' | 'CASH' | 'DIGITAL')} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm disabled:bg-gray-100" disabled={!feeAccountId || !feeCurrencyId}>
                <option value="">—</option>
                {formatsFor(feeAccountId, feeCurrencyId).map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
              </select>
              {feeAccountId && feeCurrencyId && formatsFor(feeAccountId, feeCurrencyId).length === 0 && (
                <p className="mt-1 text-[11px] text-gray-500">No hay formato habilitado para esta cuenta/divisa.</p>
              )}
            </div>
            <label className="sm:col-span-2 lg:col-span-2 flex items-end pb-2 text-sm text-gray-700 cursor-pointer select-none gap-2">
              <input
                type="checkbox"
                checked={feeSettlement === 'PENDIENTE'}
                onChange={(e) => setFeeSettlement(e.target.checked ? 'PENDIENTE' : 'REAL')}
                disabled={feeTreatment === 'INCLUIDA'}
              />
              Comisión pendiente
            </label>
            {feeTreatment === 'INCLUIDA' && <p className="sm:col-span-2 lg:col-span-2 mt-1 text-[11px] text-gray-500">Con incluida no aplica pendiente de comisión.</p>}
            <MoneyInput label={feeMode === 'PERCENT' ? 'Porcentaje' : 'Monto fijo'} value={feeValue} onValueChange={setFeeValue} fractionDigits={feeMode === 'PERCENT' ? 4 : 2} />
            <div className="flex items-end">
              {expectedFee > 0 && <p className="text-sm font-mono text-gray-600">Comisión: <span className="font-medium">{feeCurrCode} {formatMoneyAR(expectedFee)}</span></p>}
            </div>
            <p className="text-xs text-gray-600 sm:col-span-2 lg:col-span-4">{feeImpactLabel}</p>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Impacto cliente</legend>
        <div className="bg-gray-50 rounded p-3 text-sm space-y-1.5">
          <p className="text-xs text-gray-600">Pendiente no duplica CC; solo indica que la ejecución real queda abierta.</p>
          <div className="grid grid-cols-2 gap-x-2 sm:gap-x-4 gap-y-1 font-mono text-gray-700 text-xs sm:text-sm [&>span]:min-w-0 [&>span]:break-words">
            <span>Salida:</span>
            <span>{outCurrCode} {formatMoneyAR(outAbs)} ({settlementLabel(outLeg.settlement)})</span>
            <span>Entrada:</span>
            <span>{inCurrCode} {formatMoneyAR(inAbs)} ({settlementLabel(inLeg.settlement)})</span>
            <span>Pendiente salida:</span>
            <span>{outPendingLabel}</span>
            <span>Pendiente entrada:</span>
            <span>{inPendingLabel}</span>
            {feeEnabled && expectedFee > 0 && (
              <>
                <span>Comisión ({feeTreatment === 'APARTE' ? '+' : '−'}):</span>
                <span>{feeCurrCode} {formatMoneyAR(expectedFee)}</span>
              </>
            )}
            {feeEnabled && feeTreatment === 'INCLUIDA' && (
              <>
                <span>Neto salida (incluida):</span>
                <span>{outCurrCode} {formatMoneyAR(includedNetAmount)}</span>
              </>
            )}
            <span className="border-t border-gray-200 pt-1 font-semibold">Impacto comercial (CC):</span>
            <span className="border-t border-gray-200 pt-1 font-semibold">
              {!clientCcEnabled
                ? 'No aplica (cliente sin CC habilitada)'
                : feeEnabled
                  ? feeImpactLabel
                  : 'Sin comisión'}
            </span>
            <span>Impacto real ahora:</span>
            <span>Solo patas/commission en REAL</span>
            <span>Pendiente operativo:</span>
            <span>Solo patas/commission en PENDIENTE</span>
            <span>Liquidación comisión:</span>
            <span>
              {feeEnabled
                ? settlementLabel((feeSettlement === 'REAL' || feeTreatment === 'INCLUIDA') ? 'REAL' : 'PENDIENTE')
                : 'N/A'}
            </span>
            <span>Tipo pendiente comisión:</span>
            <span>
              {feeEnabled && feeSettlement === 'PENDIENTE' && feeTreatment === 'APARTE'
                ? (feePayer === 'CLIENTE_PAGA' ? 'PENDIENTE_DE_COBRO_COMISION' : 'PENDIENTE_DE_PAGO_COMISION')
                : 'N/A'}
            </span>
          </div>
          {feeEnabled && feeTreatment === 'INCLUIDA' && includedNetAmount <= 0 && (
            <p className="text-red-600 text-xs mt-1">Con comisión incluida, el neto debe ser mayor a 0.</p>
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Totales</legend>
        <div className="bg-gray-50 rounded p-3 text-sm">
          {totalsByCurrency.length === 0 ? (
            <p className="text-gray-500 text-xs">Completá datos para ver totales.</p>
          ) : (
            <div className="space-y-2">
              {totalsByCurrency.map((row) => (
                <div key={row.code} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 font-mono text-gray-700 text-xs sm:text-sm [&>span]:min-w-0 [&>span]:break-words">
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
