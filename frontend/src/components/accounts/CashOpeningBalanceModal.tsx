import { useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import FormActionsRow from '../common/FormActionsRow';
import { allowedFormatsFromList, formatLabel, resolveFormat } from '../../utils/accountCurrencyFormats';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';

interface AccountCurrency {
  currency_id: string;
  currency_code: string;
  currency_name: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

type LineRow = {
  key: string;
  account_id: string;
  currency_id: string;
  format: string;
  amount: string;
};

function makeLine(): LineRow {
  return {
    key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    account_id: '',
    currency_id: '',
    format: 'CASH',
    amount: '',
  };
}

export default function CashOpeningBalanceModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const accounts = useActiveAccounts();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineRow[]>([makeLine()]);
  const [currenciesByLine, setCurrenciesByLine] = useState<Record<string, AccountCurrency[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useBodyScrollLock(true);

  function loadCurrenciesForLine(key: string, accountId: string) {
    if (!accountId) {
      setCurrenciesByLine((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    api
      .get<AccountCurrency[]>(`/accounts/${accountId}/currencies`)
      .then((acs) => setCurrenciesByLine((prev) => ({ ...prev, [key]: acs })))
      .catch(() => setCurrenciesByLine((prev) => ({ ...prev, [key]: [] })));
  }

  function setAccount(key: string, accountId: string) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, account_id: accountId, currency_id: '', format: 'CASH' } : l)),
    );
    loadCurrenciesForLine(key, accountId);
  }

  function setCurrency(key: string, currencyId: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const acs = currenciesByLine[key] || [];
        const allowed = allowedFormatsFromList(acs, currencyId);
        const fmt = resolveFormat(allowed, l.format) || 'CASH';
        return { ...l, currency_id: currencyId, format: fmt };
      }),
    );
  }

  function addLine() {
    setLines((prev) => [...prev, makeLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
    setCurrenciesByLine((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    for (const l of lines) {
      if (!l.account_id || !l.currency_id || !l.amount.trim()) {
        setError('Completá cuenta, divisa y monto en cada línea.');
        return;
      }
      if (parseFloat(l.amount) <= 0) {
        setError('Los montos deben ser mayores a cero.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        date,
        lines: lines.map((l) => ({
          account_id: l.account_id,
          currency_id: l.currency_id,
          format: l.format,
          amount: l.amount.trim(),
        })),
      };
      const n = note.trim();
      if (n) body.note = n;
      const res = await api.post<{ movement_id: string; operation_number: number }>(
        '/movements/saldo-inicial-caja',
        body,
      );
      onClose();
      navigate(`/movimientos/${res.movement_id}`);
    } catch (err: unknown) {
      const m = err && typeof err === 'object' && 'message' in err ? String((err as { message?: string }).message) : '';
      setError(m || 'No se pudo registrar el saldo inicial.');
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel modal-enter max-w-2xl w-full p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-fg mb-1">Saldo inicial de caja</h3>
        <p className="text-xs text-fg-muted mb-4">
          Movimiento auditable (líneas IN reales). No afecta cuenta corriente de clientes.
        </p>
        {error && <p className="text-error text-sm mb-3">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-sm font-medium text-fg mb-0.5">Fecha</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border border-subtle rounded px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-fg mb-0.5">Nota (opcional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="space-y-3">
            {lines.map((line) => {
              const acs = currenciesByLine[line.key] || [];
              const allowed = allowedFormatsFromList(acs, line.currency_id);
              return (
                <div key={line.key} className="border border-subtle rounded-lg p-3 space-y-2 bg-surface/50">
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
                      <select
                        value={line.account_id}
                        onChange={(e) => setAccount(line.key, e.target.value)}
                        className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                        required
                      >
                        <option value="">Elegir…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
                      <select
                        value={line.currency_id}
                        onChange={(e) => setCurrency(line.key, e.target.value)}
                        className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                        required
                      >
                        <option value="">Elegir…</option>
                        {acs.map((c) => (
                          <option key={c.currency_id} value={c.currency_id}>
                            {c.currency_code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-28">
                      <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
                      <select
                        value={allowed.length ? line.format : ''}
                        disabled={allowed.length === 0}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l) => (l.key === line.key ? { ...l, format: e.target.value } : l)),
                          )
                        }
                        className="w-full border border-subtle rounded px-2 py-1.5 text-sm disabled:bg-surface"
                      >
                        {allowed.length === 0 ? (
                          <option value="">—</option>
                        ) : (
                          allowed.map((f) => (
                            <option key={f} value={f}>
                              {formatLabel(f)}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="flex-1 min-w-[100px]">
                      <label className="block text-xs text-fg-muted mb-0.5">Monto</label>
                      <MoneyInput
                        value={line.amount}
                        onValueChange={(v) =>
                          setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, amount: v } : l)))
                        }
                        fractionDigits={8}
                        className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                      />
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="text-sm text-error hover:text-error px-2 py-1"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addLine}
            className="text-sm text-info hover:text-info font-medium"
          >
            + Línea
          </button>

          <FormActionsRow
            variant="modal"
            primary={
              <button
                type="submit"
                disabled={submitting}
                className="btn-touch bg-brand text-white rounded-md font-medium hover:bg-brand-hover disabled:opacity-60"
              >
                {submitting ? 'Guardando…' : 'Confirmar'}
              </button>
            }
            cancel={
              <button
                type="button"
                onClick={onClose}
                className="btn-touch border border-subtle text-fg rounded-md hover:bg-surface"
              >
                Cancelar
              </button>
            }
          />
        </form>
      </div>
    </div>,
    document.body,
  );
}
