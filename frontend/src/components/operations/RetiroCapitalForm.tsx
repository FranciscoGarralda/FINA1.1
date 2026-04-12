import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import OperationFormActions from './OperationFormActions';
import { allowedFormatsFromList, formatLabel, type MovementFormat } from '../../utils/accountCurrencyFormats';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';

interface AccountCurrency {
  currency_id: string; currency_code: string; currency_name: string;
  cash_enabled: boolean; digital_enabled: boolean;
}

interface RetiroCapitalDraftData {
  accountId: string;
  currencyId: string;
  format: string;
  amount: string;
  note: string;
}

export default function RetiroCapitalForm({ movementId, onDone, onCancel }: { movementId: string; onDone: () => void; onCancel: () => void }) {
  const accounts = useActiveAccounts();
  const [accountId, setAccountId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [format, setFormat] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [accountCurrencies, setAccountCurrencies] = useState<AccountCurrency[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!accountId) { setAccountCurrencies([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${accountId}/currencies`).then(setAccountCurrencies).catch(() => setAccountCurrencies([]));
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<RetiroCapitalDraftData>(movementId, 'RETIRO_CAPITAL')
      .then((draft) => {
        if (cancelled || !draft) return;
        setAccountId(draft.accountId || '');
        setCurrencyId(draft.currencyId || '');
        setFormat(draft.format || 'CASH');
        setAmount(draft.amount || '');
        setNote(draft.note || '');
        setDraftMessage('Borrador reanudado.');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  async function handleSubmit() {
    setError('');

    if (!accountId || !currencyId || !amount) { setError('Completá todos los campos obligatorios.'); return; }
    if (parseFloat(amount) <= 0) { setError('El monto debe ser mayor a 0.'); return; }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/retiro-capital`, {
        account_id: accountId,
        currency_id: currencyId,
        format,
        amount,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el retiro de capital.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildDraftData(): RetiroCapitalDraftData {
    return { accountId, currencyId, format, amount, note };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'RETIRO_CAPITAL', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setAccountId('');
    setCurrencyId('');
    setFormat('CASH');
    setAmount('');
    setNote('');
    setAccountCurrencies([]);
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="success-message">Retiro de capital registrado correctamente.</p>
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

      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Retiro de capital</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setCurrencyId(''); }} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
            <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accountCurrencies.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as MovementFormat)}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              disabled={!currencyId || allowedFormatsFromList(accountCurrencies, currencyId).length === 0}
            >
              {allowedFormatsFromList(accountCurrencies, currencyId).map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {currencyId && allowedFormatsFromList(accountCurrencies, currencyId).length === 0 && (
              <p className="text-xs text-error mt-1">Sin formato habilitado para esta divisa en la cuenta.</p>
            )}
          </div>
          <MoneyInput label="Monto" value={amount} onValueChange={setAmount} />
        </div>
        <div className="mt-3 max-w-sm">
          <label className="block text-xs text-fg-muted mb-0.5">Nota (opcional)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Descripción del retiro..."
            className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
          />
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
