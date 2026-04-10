import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR } from '../../utils/money';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import OperationFormActions from './OperationFormActions';
import { allowedFormatsFromList, formatLabel, resolveFormat, type MovementFormat } from '../../utils/accountCurrencyFormats';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';
import { useActiveCurrencies } from '../../hooks/useActiveCurrencies';

interface AccountCurrency {
  currency_id: string; currency_code: string; currency_name: string;
  cash_enabled: boolean; digital_enabled: boolean;
}
interface CCBalance { currency_id: string; currency_code: string; balance: string; }

interface PagoCCCruzadoDraftData {
  payAccountId: string;
  payCurrencyId: string;
  payFormat: string;
  payAmount: string;
  debtCurrencyId: string;
  cancelAmount: string;
  mode?: 'ENTRA' | 'SALE';
}

interface Props {
  movementId: string;
  clientId: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function PagoCCCruzadoForm({ movementId, clientId, onDone, onCancel }: Props) {
  const accounts = useActiveAccounts();
  const currencies = useActiveCurrencies();
  const [ccBalances, setCCBalances] = useState<CCBalance[]>([]);

  // Real flow
  const [mode, setMode] = useState<'ENTRA' | 'SALE'>('ENTRA');
  const [payAccountId, setPayAccountId] = useState('');
  const [payCurrencyId, setPayCurrencyId] = useState('');
  const [payFormat, setPayFormat] = useState('CASH');
  const [payAmount, setPayAmount] = useState('');
  const [payAC, setPayAC] = useState<AccountCurrency[]>([]);

  // Cancel (CC debt reduction)
  const [debtCurrencyId, setDebtCurrencyId] = useState('');
  const [cancelAmount, setCancelAmount] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (clientId) {
      api.get<CCBalance[]>(`/cc-balances/${clientId}`).then(setCCBalances).catch(() => setCCBalances([]));
    } else {
      setCCBalances([]);
    }
  }, [clientId]);

  useEffect(() => {
    if (!payAccountId) { setPayAC([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${payAccountId}/currencies`).then(setPayAC).catch(() => setPayAC([]));
  }, [payAccountId]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<PagoCCCruzadoDraftData>(movementId, 'PAGO_CC_CRUZADO')
      .then((draft) => {
        if (cancelled || !draft) return;
        setPayAccountId(draft.payAccountId || '');
        setPayCurrencyId(draft.payCurrencyId || '');
        setPayFormat(draft.payFormat || 'CASH');
        setPayAmount(draft.payAmount || '');
        setDebtCurrencyId(draft.debtCurrencyId || '');
        setCancelAmount(draft.cancelAmount || '');
        setMode(draft.mode === 'SALE' ? 'SALE' : 'ENTRA');
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
    if (!payCurrencyId) return;
    const allowed = allowedFormatsFromList(payAC, payCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, payFormat);
    if (next && next !== payFormat) setPayFormat(next);
  }, [payAC, payCurrencyId, payFormat]);

  const sameCurrency = payCurrencyId && debtCurrencyId && payCurrencyId === debtCurrencyId;
  const debtBalance = useMemo(() => {
    if (!debtCurrencyId) return null;
    const found = ccBalances.find((b) => b.currency_id === debtCurrencyId);
    return found ? found.balance : '0';
  }, [debtCurrencyId, ccBalances]);

  const debtCurrencyCode = currencies.find((c) => c.id === debtCurrencyId)?.code || '';

  async function handleSubmit() {
    setError('');

    if (!payAccountId || !payCurrencyId || !payAmount) { setError('Completá la sección de pago.'); return; }
    if (!debtCurrencyId || !cancelAmount) { setError('Completá la sección de cancelación.'); return; }
    if (parseFloat(payAmount) <= 0) { setError('El monto pagado debe ser mayor a 0.'); return; }
    if (parseFloat(cancelAmount) <= 0) { setError('El monto a cancelar debe ser mayor a 0.'); return; }

    if (sameCurrency && payAmount !== cancelAmount) {
      setError('Los montos deben coincidir cuando la divisa es la misma.');
      return;
    }

    if (debtBalance !== null && parseFloat(debtBalance) === 0) {
      setError('No hay saldo de CC en esta divisa para cancelar.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/pago-cc-cruzado`, {
        payment: {
          account_id: payAccountId,
          currency_id: payCurrencyId,
          format: payFormat,
          amount: payAmount,
        },
        cancel: {
          currency_id: debtCurrencyId,
          amount: cancelAmount,
        },
        mode,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el pago CC cruzado.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildDraftData(): PagoCCCruzadoDraftData {
    return {
      payAccountId,
      payCurrencyId,
      payFormat,
      payAmount,
      debtCurrencyId,
      cancelAmount,
      mode,
    };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'PAGO_CC_CRUZADO', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setPayAccountId('');
    setPayCurrencyId('');
    setPayFormat('CASH');
    setPayAmount('');
    setPayAC([]);
    setDebtCurrencyId('');
    setCancelAmount('');
    setMode('ENTRA');
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="text-success font-medium mb-4">Pago CC cruzado registrado correctamente.</p>
        <button onClick={onDone} className="px-4 py-2 bg-success text-white text-sm rounded hover:opacity-90 transition">
          Ver movimiento
        </button>
      </div>
    );
  }

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-error text-sm">{error}</p>}
      {draftMessage && <p className="text-info text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-fg-muted text-sm">Cargando borrador...</p>}

      <p className="rounded-md border border-subtle bg-brand-soft px-3 py-2 text-xs text-fg">
        Si el pago real y la deuda de CC son en <strong>divisas distintas</strong>, cargá cada monto acordado (palo a palo); no hace falta tipo de cambio del sistema. Con la <strong>misma</strong> divisa, pago y cancelación deben ser iguales.
      </p>

      {/* FLUJO REAL */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Flujo real</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Modo</label>
            <select value={mode} onChange={(e) => setMode(e.target.value === 'SALE' ? 'SALE' : 'ENTRA')} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="ENTRA">ENTRA</option>
              <option value="SALE">SALE</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
            <select value={payAccountId} onChange={(e) => { setPayAccountId(e.target.value); setPayCurrencyId(''); }} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa pago</label>
            <select value={payCurrencyId} onChange={(e) => setPayCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {payAC.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
            <select
              value={payFormat}
              onChange={(e) => setPayFormat(e.target.value as MovementFormat)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              disabled={!payCurrencyId || allowedFormatsFromList(payAC, payCurrencyId).length === 0}
            >
              {allowedFormatsFromList(payAC, payCurrencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {payCurrencyId && allowedFormatsFromList(payAC, payCurrencyId).length === 0 && (
              <p className="text-xs text-error mt-1">Sin formato habilitado para esta divisa en la cuenta.</p>
            )}
          </div>
          <MoneyInput label={`Monto real (${mode})`} value={payAmount} onValueChange={setPayAmount} />
        </div>
      </fieldset>

      {/* CANCELACIÓN CC */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Cancelación CC</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa deuda</label>
            <select value={debtCurrencyId} onChange={(e) => setDebtCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {currencies.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </div>
          <MoneyInput label="Monto a cancelar" value={cancelAmount} onValueChange={setCancelAmount} />
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">CC actual</label>
            <p className={`text-sm font-mono py-1.5 font-medium ${
              debtBalance !== null && parseFloat(debtBalance) < 0 ? 'text-error' :
              debtBalance !== null && parseFloat(debtBalance) > 0 ? 'text-success' : 'text-fg-muted'
            }`}>
              {debtBalance !== null && debtCurrencyCode
                ? `${debtCurrencyCode} ${formatMoneyAR(debtBalance)}`
                : '—'}
            </p>
          </div>
        </div>

        <p className="text-xs text-fg-muted mt-2">
          El impacto en CC se calcula automáticamente según saldo vivo en la divisa de cancelación.
        </p>

        {sameCurrency && (
          <p className="text-xs text-fg-muted mt-2">Misma divisa — los montos deben coincidir.</p>
        )}
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
