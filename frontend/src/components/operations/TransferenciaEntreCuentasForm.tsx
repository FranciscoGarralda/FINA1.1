import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR } from '../../utils/money';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import { allowedFormatsFromList, formatLabel, resolveFormat } from '../../utils/accountCurrencyFormats';

interface Account { id: string; name: string; active: boolean; }
interface AccountCurrency {
  currency_id: string; currency_code: string; currency_name: string;
  cash_enabled: boolean; digital_enabled: boolean;
}

interface TransferenciaEntreCuentasDraftData {
  fromAccountId: string;
  fromCurrencyId: string;
  fromFormat: string;
  fromAmount: string;
  toAccountId: string;
  toFormat: string;
}

export default function TransferenciaEntreCuentasForm({ movementId, onDone, onCancel }: { movementId: string; onDone: () => void; onCancel: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);

  // FROM (OUT)
  const [fromAccountId, setFromAccountId] = useState('');
  const [fromCurrencyId, setFromCurrencyId] = useState('');
  const [fromFormat, setFromFormat] = useState('CASH');
  const [fromAmount, setFromAmount] = useState('');
  const [fromAC, setFromAC] = useState<AccountCurrency[]>([]);

  // TO (IN)
  const [toAccountId, setToAccountId] = useState('');
  const [toFormat, setToFormat] = useState('CASH');
  const [toAC, setToAC] = useState<AccountCurrency[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.get<Account[]>('/accounts').then((a) => setAccounts(a.filter((x) => x.active)));
  }, []);

  useEffect(() => {
    if (!fromAccountId) { setFromAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${fromAccountId}/currencies`).then(setFromAC).catch(() => setFromAC([]));
  }, [fromAccountId]);

  useEffect(() => {
    if (!toAccountId) { setToAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${toAccountId}/currencies`).then(setToAC).catch(() => setToAC([]));
  }, [toAccountId]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<TransferenciaEntreCuentasDraftData>(movementId, 'TRANSFERENCIA_ENTRE_CUENTAS')
      .then((draft) => {
        if (cancelled || !draft) return;
        setFromAccountId(draft.fromAccountId || '');
        setFromCurrencyId(draft.fromCurrencyId || '');
        setFromFormat(draft.fromFormat || 'CASH');
        setFromAmount(draft.fromAmount || '');
        setToAccountId(draft.toAccountId || '');
        setToFormat(draft.toFormat || 'CASH');
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
    if (!fromCurrencyId) return;
    const allowed = allowedFormatsFromList(fromAC, fromCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, fromFormat);
    if (next && next !== fromFormat) setFromFormat(next);
  }, [fromAC, fromCurrencyId, fromFormat]);

  useEffect(() => {
    if (!fromCurrencyId || !toAccountId) return;
    const allowed = allowedFormatsFromList(toAC, fromCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, toFormat);
    if (next && next !== toFormat) setToFormat(next);
  }, [toAC, fromCurrencyId, toAccountId, toFormat]);

  const fromCurrencyCode = fromAC.find((ac) => ac.currency_id === fromCurrencyId)?.currency_code || '';

  const toCurrencyValid = toAC.some((ac) => ac.currency_id === fromCurrencyId);

  async function handleSubmit() {
    setError('');

    if (!fromAccountId || !fromCurrencyId || !fromAmount) { setError('Completá la sección de salida.'); return; }
    if (!toAccountId) { setError('Seleccioná la cuenta destino.'); return; }
    if (fromAccountId === toAccountId) { setError('La cuenta origen y destino no pueden ser la misma.'); return; }
    if (parseFloat(fromAmount) <= 0) { setError('Monto inválido.'); return; }
    if (toAccountId && fromCurrencyId && !toCurrencyValid) { setError('La divisa no está habilitada en la cuenta destino.'); return; }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/transferencia-entre-cuentas`, {
        from: {
          account_id: fromAccountId,
          currency_id: fromCurrencyId,
          format: fromFormat,
          amount: fromAmount,
        },
        to: {
          account_id: toAccountId,
          format: toFormat,
        },
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar la transferencia.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildDraftData(): TransferenciaEntreCuentasDraftData {
    return {
      fromAccountId,
      fromCurrencyId,
      fromFormat,
      fromAmount,
      toAccountId,
      toFormat,
    };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'TRANSFERENCIA_ENTRE_CUENTAS', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setFromAccountId('');
    setFromCurrencyId('');
    setFromFormat('CASH');
    setFromAmount('');
    setFromAC([]);
    setToAccountId('');
    setToFormat('CASH');
    setToAC([]);
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="text-green-700 font-medium mb-4">Transferencia entre cuentas registrada correctamente.</p>
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

      <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        Esta operación mueve <strong>una sola divisa</strong> entre dos cuentas (mismo monto). Para liquidar en <strong>dos divisas</strong> (palo a palo) con titular/cliente usá <strong>Transferencia</strong> en Nueva operación.
      </p>

      {/* SALIDA (FROM / OUT) */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Salida (origen)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta origen</label>
            <select value={fromAccountId} onChange={(e) => { setFromAccountId(e.target.value); setFromCurrencyId(''); }} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={fromCurrencyId} onChange={(e) => setFromCurrencyId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {fromAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={fromFormat}
              onChange={(e) => setFromFormat(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={!fromCurrencyId || allowedFormatsFromList(fromAC, fromCurrencyId).length === 0}
            >
              {allowedFormatsFromList(fromAC, fromCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
          </div>
          <MoneyInput label="Monto" value={fromAmount} onValueChange={setFromAmount} />
        </div>
      </fieldset>

      {/* ENTRADA (TO / IN) */}
      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Entrada (destino)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cuenta destino</label>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.filter((a) => a.id !== fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <input type="text" readOnly value={fromCurrencyCode || '—'} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Formato</label>
            <select
              value={toFormat}
              onChange={(e) => setToFormat(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              disabled={!fromCurrencyId || !toAccountId || allowedFormatsFromList(toAC, fromCurrencyId).length === 0}
            >
              {allowedFormatsFromList(toAC, fromCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Monto</label>
            <input type="text" readOnly value={fromAmount ? formatMoneyAR(fromAmount) : '—'} className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-500 font-mono" />
          </div>
        </div>
        {toAccountId && fromCurrencyId && !toCurrencyValid && (
          <p className="text-xs text-red-500 mt-1">La divisa no está habilitada en la cuenta destino.</p>
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
