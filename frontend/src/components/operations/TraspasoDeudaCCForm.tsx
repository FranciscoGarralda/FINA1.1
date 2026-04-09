import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import OperationFormActions from './OperationFormActions';
import { useActiveCurrencies } from '../../hooks/useActiveCurrencies';

interface Client {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  active: boolean;
  cc_enabled: boolean;
}

interface TraspasoDeudaCCDraftData {
  toClientId: string;
  currencyId: string;
  amount: string;
  note: string;
}

interface Props {
  movementId: string;
  clientId: string;
  onDone: () => void;
  onCancel: () => void;
}

export default function TraspasoDeudaCCForm({ movementId, clientId, onDone, onCancel }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const currencies = useActiveCurrencies(true);
  const [fromClient, setFromClient] = useState<Client | null>(null);

  const [toClientId, setToClientId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.get<Client[]>('/clients')
      .then((list) => setClients(list.filter((c) => c.active && c.cc_enabled)))
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (!clientId) return;
    api.get<Client>(`/clients/${clientId}`)
      .then((c) => setFromClient(c))
      .catch(() => setFromClient(null));
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<TraspasoDeudaCCDraftData>(movementId, 'TRASPASO_DEUDA_CC')
      .then((draft) => {
        if (cancelled || !draft) return;
        setToClientId(draft.toClientId || '');
        setCurrencyId(draft.currencyId || '');
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

  const destinationClients = useMemo(() => {
    return clients.filter((c) => c.id !== clientId);
  }, [clients, clientId]);

  async function handleSubmit() {
    setError('');
    if (!toClientId) { setError('Seleccioná el cliente destino.'); return; }
    if (!currencyId) { setError('Seleccioná la divisa.'); return; }
    if (!amount || parseFloat(amount) <= 0) { setError('El monto debe ser mayor a 0.'); return; }
    if (toClientId === clientId) { setError('El cliente origen y destino no pueden coincidir.'); return; }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/traspaso-deuda-cc`, {
        to_client_id: toClientId,
        currency_id: currencyId,
        amount,
        note: note.trim() || undefined,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.message || 'Error al guardar el traspaso de deuda CC.');
    } finally {
      setSubmitting(false);
    }
  }

  function buildDraftData(): TraspasoDeudaCCDraftData {
    return { toClientId, currencyId, amount, note };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'TRASPASO_DEUDA_CC', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setToClientId('');
    setCurrencyId('');
    setAmount('');
    setNote('');
  }

  if (success) {
    return (
      <div className="border-t pt-4">
        <p className="text-green-700 font-medium mb-4">Traspaso de deuda CC registrado correctamente.</p>
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

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Origen y destino</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cliente origen (cabecera)</label>
            <input
              disabled
              value={fromClient ? `#${fromClient.client_code} — ${fromClient.last_name}, ${fromClient.first_name}` : clientId}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm bg-gray-50 text-gray-600"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Cliente destino (CC)</label>
            <select value={toClientId} onChange={(e) => setToClientId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {destinationClients.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.client_code} — {c.last_name}, {c.first_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-gray-700 mb-2">Datos del traspaso</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-0.5">Divisa</label>
            <select value={currencyId} onChange={(e) => setCurrencyId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {currencies.map((c) => (
                <option key={c.id} value={c.id}>{c.code}</option>
              ))}
            </select>
          </div>
          <MoneyInput label="Monto" value={amount} onValueChange={setAmount} />
        </div>
        <div className="mt-3">
          <label className="block text-xs text-gray-500 mb-0.5">Motivo (opcional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            placeholder="Ej: Traspaso por acuerdo comercial"
            maxLength={200}
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
