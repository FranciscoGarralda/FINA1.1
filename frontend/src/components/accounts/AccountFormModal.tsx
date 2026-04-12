import { useState, useEffect, FormEvent, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import FormActionsRow from '../common/FormActionsRow';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

interface Account {
  id: string;
  name: string;
  active: boolean;
}

interface Currency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface AccountCurrency {
  currency_id: string;
  currency_code: string;
  currency_name: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

interface CurrencyRow {
  currency_id: string;
  code: string;
  name: string;
  enabled: boolean;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

interface Props {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function AccountFormModal({ account, onClose, onSaved }: Props) {
  const isEdit = !!account;

  const [name, setName] = useState('');
  const [currencyRows, setCurrencyRows] = useState<CurrencyRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingCurrencies, setLoadingCurrencies] = useState(true);

  const backdropRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({
    containerRef: backdropRef,
    onClose,
    refocusToken: loadingCurrencies ? 'currencies-loading' : 'currencies-ready',
  });

  useEffect(() => {
    if (account) setName(account.name);
  }, [account]);

  useBodyScrollLock(true);

  useEffect(() => {
    const load = async () => {
      try {
        const allCurrencies = await api.get<Currency[]>('/currencies');
        const activeCurrencies = allCurrencies.filter((c) => c.active);

        let accountCurrencies: AccountCurrency[] = [];
        if (isEdit) {
          accountCurrencies = await api.get<AccountCurrency[]>(`/accounts/${account!.id}/currencies`);
        }

        const acMap = new Map<string, AccountCurrency>();
        accountCurrencies.forEach((ac) => acMap.set(ac.currency_id, ac));

        const rows: CurrencyRow[] = activeCurrencies.map((c) => {
          const ac = acMap.get(c.id);
          return {
            currency_id: c.id,
            code: c.code,
            name: c.name,
            enabled: !!ac,
            cash_enabled: ac?.cash_enabled ?? true,
            digital_enabled: ac?.digital_enabled ?? true,
          };
        });

        setCurrencyRows(rows);
      } catch {
        setCurrencyRows([]);
      } finally {
        setLoadingCurrencies(false);
      }
    };
    load();
  }, [account, isEdit]);

  const toggleEnabled = (idx: number) => {
    setCurrencyRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const newEnabled = !r.enabled;
        return {
          ...r,
          enabled: newEnabled,
          cash_enabled: newEnabled ? r.cash_enabled : false,
          digital_enabled: newEnabled ? r.digital_enabled : false,
        };
      })
    );
  };

  const toggleField = (idx: number, field: 'cash_enabled' | 'digital_enabled') => {
    setCurrencyRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: !r[field] } : r))
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('El nombre de la cuenta es obligatorio.');
      return;
    }

    const enabledRows = currencyRows.filter((r) => r.enabled);
    for (const row of enabledRows) {
      if (!row.cash_enabled && !row.digital_enabled) {
        setError(`Debe habilitar Efectivo o Digital para ${row.code}.`);
        return;
      }
    }

    setSaving(true);
    try {
      let accountId = account?.id;

      if (isEdit) {
        await api.put(`/accounts/${accountId}`, { name: name.trim() });
      } else {
        const res = await api.post<{ id: string }>('/accounts', { name: name.trim() });
        accountId = res.id;
      }

      const payload = enabledRows.map((r) => ({
        currency_id: r.currency_id,
        cash_enabled: r.cash_enabled,
        digital_enabled: r.digital_enabled,
      }));

      await api.put(`/accounts/${accountId}/currencies`, payload);

      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Error al guardar cuenta.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div ref={backdropRef} className="modal-backdrop">
      <div className="modal-panel modal-enter max-w-lg p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Editar Cuenta' : 'Nueva Cuenta'}</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-fg mb-1">Nombre de cuenta</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Caja principal"
              className="w-full border border-subtle rounded-md px-3 py-2 text-base focus:outline-none focus:border-brand shadow-focus-brand"
              required
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-fg mb-3">Habilitar divisas para esta cuenta</h3>
            {loadingCurrencies ? (
              <p className="text-fg-subtle text-sm">Cargando divisas...</p>
            ) : currencyRows.length === 0 ? (
              <p className="text-fg-subtle text-sm">No hay divisas activas. Creá divisas primero.</p>
            ) : (
              <div className="border rounded-md divide-y">
                {currencyRows.map((row, idx) => (
                  <div key={row.currency_id} className="px-3 py-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <label className="flex items-center gap-2 min-w-0 sm:min-w-[140px]">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={() => toggleEnabled(idx)}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-fg">
                        {row.code}
                        <span className="text-fg-subtle font-normal ml-1">({row.name})</span>
                      </span>
                    </label>
                    <label className={`flex items-center gap-1 text-sm ${!row.enabled ? 'opacity-40' : ''}`}>
                      <input
                        type="checkbox"
                        checked={row.cash_enabled}
                        disabled={!row.enabled}
                        onChange={() => toggleField(idx, 'cash_enabled')}
                        className="rounded"
                      />
                      Efectivo
                    </label>
                    <label className={`flex items-center gap-1 text-sm ${!row.enabled ? 'opacity-40' : ''}`}>
                      <input
                        type="checkbox"
                        checked={row.digital_enabled}
                        disabled={!row.enabled}
                        onChange={() => toggleField(idx, 'digital_enabled')}
                        className="rounded"
                      />
                      Digital
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-error text-sm">{error}</p>}

          <FormActionsRow
            variant="modal"
            cancel={
              <button
                type="button"
                onClick={onClose}
                className="btn-touch border border-subtle text-fg rounded-md hover:bg-surface"
              >
                Cancelar
              </button>
            }
            primary={
              <button
                type="submit"
                disabled={saving}
                className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50 font-medium"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            }
          />
        </form>
      </div>
    </div>,
    document.body
  );
}
