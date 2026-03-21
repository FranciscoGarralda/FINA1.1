import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR, numberToNormalizedMoney } from '../../utils/money';
import OperationAmountCalculator from './OperationAmountCalculator';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import {
  allowedFormatsFromList,
  formatLabel,
  resolveFormat,
  type MovementFormat,
} from '../../utils/accountCurrencyFormats';

interface Account { id: string; name: string; active: boolean; }
interface Currency { id: string; code: string; name: string; active: boolean; }
interface AccountCurrency {
  currency_id: string; currency_code: string; currency_name: string;
  cash_enabled: boolean; digital_enabled: boolean;
}

interface ArbitrajeDraftData {
  costoAccountId: string;
  costoCurrencyId: string;
  costoFormat: string;
  costoAmount: string;
  costoPending: boolean;
  cobradoAccountId: string;
  cobradoCurrencyId: string;
  cobradoFormat: string;
  cobradoAmount: string;
  cobradoPending: boolean;
  profitAccountId: string;
  profitCurrencyId: string;
  profitFormat: string;
  profitManual: string;
  profitOverride: boolean;
}

export default function ArbitrajeForm({ movementId, onDone, onCancel }: { movementId: string; onDone: () => void; onCancel: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  // COSTO (OUT)
  const [costoAccountId, setCostoAccountId] = useState('');
  const [costoCurrencyId, setCostoCurrencyId] = useState('');
  const [costoFormat, setCostoFormat] = useState('CASH');
  const [costoAmount, setCostoAmount] = useState('');
  const [costoPending, setCostoPending] = useState(false);
  const [costoAC, setCostoAC] = useState<AccountCurrency[]>([]);

  // COBRADO (IN)
  const [cobradoAccountId, setCobradoAccountId] = useState('');
  const [cobradoCurrencyId, setCobradoCurrencyId] = useState('');
  const [cobradoFormat, setCobradoFormat] = useState('CASH');
  const [cobradoAmount, setCobradoAmount] = useState('');
  const [cobradoPending, setCobradoPending] = useState(false);
  const [cobradoAC, setCobradoAC] = useState<AccountCurrency[]>([]);

  // PROFIT
  const [profitAccountId, setProfitAccountId] = useState('');
  const [profitCurrencyId, setProfitCurrencyId] = useState('');
  const [profitFormat, setProfitFormat] = useState('CASH');
  const [profitManual, setProfitManual] = useState('');
  const [profitOverride, setProfitOverride] = useState(false);
  const [profitAC, setProfitAC] = useState<AccountCurrency[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.get<Account[]>('/accounts').then((a) => setAccounts(a.filter((x) => x.active)));
    api.get<Currency[]>('/currencies').then((c) => setCurrencies(c.filter((x) => x.active)));
  }, []);

  useEffect(() => {
    if (!costoAccountId) { setCostoAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${costoAccountId}/currencies`).then(setCostoAC).catch(() => setCostoAC([]));
  }, [costoAccountId]);

  useEffect(() => {
    if (!cobradoAccountId) { setCobradoAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${cobradoAccountId}/currencies`).then(setCobradoAC).catch(() => setCobradoAC([]));
  }, [cobradoAccountId]);

  useEffect(() => {
    if (!profitAccountId) { setProfitAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${profitAccountId}/currencies`).then(setProfitAC).catch(() => setProfitAC([]));
  }, [profitAccountId]);

  // Default profit currency to cobrado currency
  useEffect(() => {
    if (cobradoCurrencyId && !profitOverride) {
      setProfitCurrencyId(cobradoCurrencyId);
    }
  }, [cobradoCurrencyId, profitOverride]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<ArbitrajeDraftData>(movementId, 'ARBITRAJE')
      .then((draft) => {
        if (cancelled || !draft) return;
        setCostoAccountId(draft.costoAccountId || '');
        setCostoCurrencyId(draft.costoCurrencyId || '');
        setCostoFormat(draft.costoFormat || 'CASH');
        setCostoAmount(draft.costoAmount || '');
        setCostoPending(Boolean(draft.costoPending));
        setCobradoAccountId(draft.cobradoAccountId || '');
        setCobradoCurrencyId(draft.cobradoCurrencyId || '');
        setCobradoFormat(draft.cobradoFormat || 'CASH');
        setCobradoAmount(draft.cobradoAmount || '');
        setCobradoPending(Boolean(draft.cobradoPending));
        setProfitAccountId(draft.profitAccountId || '');
        setProfitCurrencyId(draft.profitCurrencyId || '');
        setProfitFormat(draft.profitFormat || 'CASH');
        setProfitManual(draft.profitManual || '');
        setProfitOverride(Boolean(draft.profitOverride));
        setDraftMessage('Borrador reanudado.');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  useEffect(() => {
    if (!costoCurrencyId) return;
    const allowed = allowedFormatsFromList(costoAC, costoCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, costoFormat);
    if (next && next !== costoFormat) {
      setCostoFormat(next);
      if (next === 'DIGITAL') setCostoPending(false);
    }
  }, [costoAC, costoCurrencyId, costoFormat]);

  useEffect(() => {
    if (!cobradoCurrencyId) return;
    const allowed = allowedFormatsFromList(cobradoAC, cobradoCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, cobradoFormat);
    if (next && next !== cobradoFormat) {
      setCobradoFormat(next);
      if (next === 'DIGITAL') setCobradoPending(false);
    }
  }, [cobradoAC, cobradoCurrencyId, cobradoFormat]);

  useEffect(() => {
    if (!profitCurrencyId) return;
    const allowed = allowedFormatsFromList(profitAC, profitCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, profitFormat);
    if (next && next !== profitFormat) setProfitFormat(next);
  }, [profitAC, profitCurrencyId, profitFormat]);

  const sameCurrency = costoCurrencyId && cobradoCurrencyId && costoCurrencyId === cobradoCurrencyId;

  const profitAuto = useMemo(() => {
    if (!sameCurrency) return null;
    const c = parseFloat(costoAmount);
    const r = parseFloat(cobradoAmount);
    if (isNaN(c) || isNaN(r)) return null;
    return r - c;
  }, [sameCurrency, costoAmount, cobradoAmount]);

  const profitValue = useMemo(() => {
    if (profitOverride || !sameCurrency) {
      return profitManual;
    }
    return profitAuto !== null ? numberToNormalizedMoney(profitAuto, 2) : '';
  }, [profitOverride, sameCurrency, profitAuto, profitManual]);

  const profitCurrencyCode = currencies.find((c) => c.id === profitCurrencyId)?.code || '';
  const requiresManualProfit = !sameCurrency;

  async function handleSubmit() {
    setError('');

    if (!costoAccountId || !costoCurrencyId || !costoAmount) { setError('Completá la sección de costo.'); return; }
    if (!cobradoAccountId || !cobradoCurrencyId || !cobradoAmount) { setError('Completá la sección de cobrado.'); return; }
    if (parseFloat(costoAmount) <= 0) { setError('El monto de costo debe ser mayor a 0.'); return; }
    if (parseFloat(cobradoAmount) <= 0) { setError('El monto cobrado debe ser mayor a 0.'); return; }
    if (!profitAccountId || !profitCurrencyId) { setError('Completá la cuenta y divisa de ganancia.'); return; }

    const finalProfit = profitValue;
    if (finalProfit === '' || finalProfit === undefined) { setError('El monto de ganancia es obligatorio.'); return; }
    if (requiresManualProfit && !profitManual) { setError('Divisas distintas: ingresá la ganancia manualmente.'); return; }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/arbitraje`, {
        costo: {
          account_id: costoAccountId,
          currency_id: costoCurrencyId,
          format: costoFormat,
          amount: costoAmount,
          pending_cash: costoPending && costoFormat === 'CASH',
        },
        cobrado: {
          account_id: cobradoAccountId,
          currency_id: cobradoCurrencyId,
          format: cobradoFormat,
          amount: cobradoAmount,
          pending_cash: cobradoPending && cobradoFormat === 'CASH',
        },
        profit: {
          account_id: profitAccountId,
          currency_id: profitCurrencyId,
          format: profitFormat,
          amount: finalProfit,
          manual_override: profitOverride || requiresManualProfit,
        },
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el arbitraje.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildDraftData(): ArbitrajeDraftData {
    return {
      costoAccountId,
      costoCurrencyId,
      costoFormat,
      costoAmount,
      costoPending,
      cobradoAccountId,
      cobradoCurrencyId,
      cobradoFormat,
      cobradoAmount,
      cobradoPending,
      profitAccountId,
      profitCurrencyId,
      profitFormat,
      profitManual,
      profitOverride,
    };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'ARBITRAJE', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setCostoAccountId('');
    setCostoCurrencyId('');
    setCostoFormat('CASH');
    setCostoAmount('');
    setCostoPending(false);
    setCostoAC([]);
    setCobradoAccountId('');
    setCobradoCurrencyId('');
    setCobradoFormat('CASH');
    setCobradoAmount('');
    setCobradoPending(false);
    setCobradoAC([]);
    setProfitAccountId('');
    setProfitCurrencyId('');
    setProfitFormat('CASH');
    setProfitManual('');
    setProfitOverride(false);
    setProfitAC([]);
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="text-green-700 font-medium mb-4">Arbitraje registrado correctamente.</p>
        <button onClick={onDone} className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition">
          Ver movimiento
        </button>
      </div>
    );
  }

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {draftMessage && <p className="text-blue-600 text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-gray-500 text-sm">Cargando borrador...</p>}

      {/* COSTO (OUT) */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Costo (SALE)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta</label>
            <select value={costoAccountId} onChange={(e) => { setCostoAccountId(e.target.value); setCostoCurrencyId(''); }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={costoCurrencyId} onChange={(e) => setCostoCurrencyId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {costoAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={costoFormat}
              onChange={(e) => {
                const v = e.target.value as MovementFormat;
                setCostoFormat(v);
                if (v === 'DIGITAL') setCostoPending(false);
              }}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={!costoCurrencyId || allowedFormatsFromList(costoAC, costoCurrencyId).length === 0}
            >
              {allowedFormatsFromList(costoAC, costoCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {costoCurrencyId && allowedFormatsFromList(costoAC, costoCurrencyId).length === 0 && (
              <p className="text-xs text-red-600 mt-1">Sin formato habilitado para esta divisa en la cuenta.</p>
            )}
          </div>
          <MoneyInput label="Monto" value={costoAmount} onValueChange={setCostoAmount} />
        </div>
        <OperationAmountCalculator onApply={setCostoAmount} />
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" checked={costoPending} onChange={(e) => setCostoPending(e.target.checked)} disabled={costoFormat !== 'CASH'} />
          <span className={costoFormat === 'CASH' ? 'text-gray-700' : 'text-gray-400'}>Pendiente de pago</span>
        </label>
      </fieldset>

      {/* COBRADO (IN) */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Cobrado (ENTRA)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta</label>
            <select value={cobradoAccountId} onChange={(e) => { setCobradoAccountId(e.target.value); setCobradoCurrencyId(''); }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={cobradoCurrencyId} onChange={(e) => setCobradoCurrencyId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {cobradoAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={cobradoFormat}
              onChange={(e) => {
                const v = e.target.value as MovementFormat;
                setCobradoFormat(v);
                if (v === 'DIGITAL') setCobradoPending(false);
              }}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={!cobradoCurrencyId || allowedFormatsFromList(cobradoAC, cobradoCurrencyId).length === 0}
            >
              {allowedFormatsFromList(cobradoAC, cobradoCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {cobradoCurrencyId && allowedFormatsFromList(cobradoAC, cobradoCurrencyId).length === 0 && (
              <p className="text-xs text-red-600 mt-1">Sin formato habilitado para esta divisa en la cuenta.</p>
            )}
          </div>
          <MoneyInput label="Monto" value={cobradoAmount} onValueChange={setCobradoAmount} />
        </div>
        <OperationAmountCalculator onApply={setCobradoAmount} />
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" checked={cobradoPending} onChange={(e) => setCobradoPending(e.target.checked)} disabled={cobradoFormat !== 'CASH'} />
          <span className={cobradoFormat === 'CASH' ? 'text-gray-700' : 'text-gray-400'}>Pendiente de retiro</span>
        </label>
      </fieldset>

      {/* PROFIT */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Ganancia</legend>

        {sameCurrency && profitAuto !== null && !profitOverride && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3 text-sm">
            <span className="text-gray-600">Ganancia calculada: </span>
            <span className={`font-mono font-medium ${profitAuto >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {currencies.find((c) => c.id === cobradoCurrencyId)?.code} {formatMoneyAR(profitAuto)}
            </span>
          </div>
        )}

        {requiresManualProfit && (
          <p className="text-xs text-amber-600 mb-2">Divisas distintas — ingresá la ganancia manualmente.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta ganancia</label>
            <select value={profitAccountId} onChange={(e) => { setProfitAccountId(e.target.value); }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa ganancia</label>
            <select value={profitCurrencyId} onChange={(e) => setProfitCurrencyId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {profitAC.length > 0
                ? profitAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)
                : currencies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)
              }
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={profitFormat}
              onChange={(e) => setProfitFormat(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={!profitCurrencyId || allowedFormatsFromList(profitAC, profitCurrencyId).length === 0}
            >
              {allowedFormatsFromList(profitAC, profitCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {profitCurrencyId && allowedFormatsFromList(profitAC, profitCurrencyId).length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Elegí una divisa habilitada en la cuenta de ganancia para el formato.</p>
            )}
          </div>
          <MoneyInput
            label={requiresManualProfit || profitOverride ? 'Monto ganancia' : 'Ajuste manual (opcional)'}
            value={profitManual}
            onValueChange={(v) => { setProfitManual(v); if (!requiresManualProfit) setProfitOverride(v !== ''); }}
            placeholder={!requiresManualProfit && profitAuto !== null ? formatMoneyAR(profitAuto) : ''}
          />
        </div>

        {!requiresManualProfit && profitOverride && (
          <button onClick={() => { setProfitOverride(false); setProfitManual(''); }} className="text-xs text-blue-600 hover:text-blue-800 mt-1">
            Volver al cálculo automático
          </button>
        )}

        {profitValue && (
          <div className="mt-2 text-sm">
            <span className="text-gray-600">Ganancia final: </span>
            <span className={`font-mono font-medium ${parseFloat(profitValue) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {profitCurrencyCode} {formatMoneyAR(profitValue)}
            </span>
          </div>
        )}
      </fieldset>

      {/* ACTIONS */}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={submitting || savingDraft || draftLoading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {submitting ? 'Guardando...' : 'Guardar'}
        </button>
        <button
          onClick={handleSaveDraft}
          disabled={submitting || savingDraft || draftLoading}
          className="px-4 py-2 text-sm text-blue-700 border border-blue-300 rounded hover:bg-blue-50 disabled:opacity-50 transition"
        >
          {savingDraft ? 'Guardando borrador...' : 'Guardar borrador'}
        </button>
        <button
          onClick={handleClear}
          disabled={submitting || savingDraft}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition"
        >
          Limpiar
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
