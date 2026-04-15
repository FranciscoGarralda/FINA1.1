import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR, numberToNormalizedMoney, roundTo } from '../../utils/money';
import { calculateEquivalent, normalizeQuoteMode, type QuoteMode } from '../../utils/fx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useActiveAccounts } from '../../hooks/useActiveAccounts';
import { useActiveCurrencies } from '../../hooks/useActiveCurrencies';
import { resolveFirstLineAmountMode, type FirstLineAmountMode } from '../../utils/lineAutofill';
import { loadOperationDraft, saveOperationDraft } from '../../utils/operationDrafts';
import OperationFormActions from './OperationFormActions';
import {
  allowedFormatsFromList,
  formatLabel,
  resolveFormat,
  type MovementFormat,
} from '../../utils/accountCurrencyFormats';

interface AccountCurrency {
  currency_id: string;
  currency_code: string;
  currency_name: string;
  cash_enabled: boolean;
  digital_enabled: boolean;
}

interface InLine {
  key: number;
  accountId: string;
  format: string;
  amount: string;
  pendingCash: boolean;
}

let lineKeyCounter = 1;

interface VentaDraftInLine {
  accountId: string;
  format: string;
  amount: string;
  pendingCash: boolean;
}

interface VentaDraftData {
  outAccountId: string;
  outCurrencyId: string;
  outFormat: string;
  outAmount: string;
  outPending: boolean;
  quoteRate: string;
  quoteCurrencyId: string;
  quoteMode: QuoteMode;
  ins: VentaDraftInLine[];
  firstInAmountMode: FirstLineAmountMode;
}

export default function VentaForm({ movementId, onDone, onCancel }: { movementId: string; onDone: () => void; onCancel: () => void }) {
  const accounts = useActiveAccounts();
  const currencies = useActiveCurrencies();

  // OUT (single — divisa vendida)
  const [outAccountId, setOutAccountId] = useState('');
  const [outCurrencyId, setOutCurrencyId] = useState('');
  const [outFormat, setOutFormat] = useState('CASH');
  const [outAmount, setOutAmount] = useState('');
  const [outPending, setOutPending] = useState(false);
  const [outAccountCurrencies, setOutAccountCurrencies] = useState<AccountCurrency[]>([]);

  // Quote
  const [quoteRate, setQuoteRate] = useState('');
  const [quoteCurrencyId, setQuoteCurrencyId] = useState('');
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('MULTIPLY');

  // INs (multiple — divisa cotización)
  const [ins, setIns] = useState<InLine[]>([{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
  const [inAccountCurrencies, setInAccountCurrencies] = useState<Record<number, AccountCurrency[]>>({});
  const [firstInAmountMode, setFirstInAmountMode] = useState<FirstLineAmountMode>('AUTO');

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  useEffect(() => {
    if (!outAccountId) { setOutAccountCurrencies([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${outAccountId}/currencies`).then(setOutAccountCurrencies).catch(() => setOutAccountCurrencies([]));
  }, [outAccountId]);

  useEffect(() => {
    ins.forEach((inLine) => {
      if (inLine.accountId && !inAccountCurrencies[inLine.key]) {
        api.get<AccountCurrency[]>(`/accounts/${inLine.accountId}/currencies`).then((acs) => {
          setInAccountCurrencies((prev) => ({ ...prev, [inLine.key]: acs }));
        });
      }
    });
  }, [ins, inAccountCurrencies]);

  const equivalent = useMemo(() => {
    const a = parseFloat(outAmount);
    const r = parseFloat(quoteRate);
    return calculateEquivalent(a, r, quoteMode);
  }, [outAmount, quoteRate, quoteMode]);
  const debouncedEquivalent = useDebouncedValue(equivalent, 300);
  const firstInKey = ins[0]?.key;
  const firstInAmount = ins[0]?.amount || '';

  const inSum = useMemo(() => {
    return ins.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
  }, [ins]);

  /** Ayuda visual (solo texto): invierte ×/÷ respecto al select (MULTIPLY → ÷, DIVIDE → ×). No modifica inputs ni `equivalent`. */
  const saleAmountVisualHint = useMemo(() => {
    const rate = parseFloat(String(quoteRate).trim().replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) return null;
    if (!Number.isFinite(inSum) || inSum <= 0) return null;
    const mode = normalizeQuoteMode(quoteMode);
    const raw = mode === 'MULTIPLY' ? inSum / rate : inSum * rate;
    return roundTo(raw, 2);
  }, [quoteRate, quoteMode, inSum]);

  const diff = equivalent - inSum;
  const outCurrencyCode = currencies.find((c) => c.id === outCurrencyId)?.code || '';
  const quoteCurrencyCode = currencies.find((c) => c.id === quoteCurrencyId)?.code || '';
  const quoteRateLabel = useMemo(() => {
    const rate = parseFloat(quoteRate);
    if (isNaN(rate) || rate <= 0) return '—';
    return formatMoneyAR(rate, 8);
  }, [quoteRate]);
  const quoteInterpretation = useMemo(() => {
    if (!outCurrencyCode || !quoteCurrencyCode) return '';
    const op = quoteMode === 'DIVIDE' ? '/' : '*';
    return `Interpretación: ${quoteCurrencyCode} = ${outCurrencyCode} ${op} ${quoteRateLabel}`;
  }, [outCurrencyCode, quoteCurrencyCode, quoteMode, quoteRateLabel]);

  const outAllowedFormats = useMemo(
    () => allowedFormatsFromList(outAccountCurrencies, outCurrencyId),
    [outAccountCurrencies, outCurrencyId],
  );

  const cuadreMsg = useMemo(() => {
    if (equivalent === 0) return '';
    const rounded = Math.round(diff * 100) / 100;
    if (rounded === 0) return '';
    if (rounded > 0) return `Te falta ${formatMoneyAR(Math.abs(rounded))} ${quoteCurrencyCode}`;
    return `Te sobra ${formatMoneyAR(Math.abs(rounded))} ${quoteCurrencyCode}`;
  }, [diff, equivalent, quoteCurrencyCode]);

  useEffect(() => {
    if (!outCurrencyId) return;
    const allowed = allowedFormatsFromList(outAccountCurrencies, outCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, outFormat);
    if (next && next !== outFormat) {
      setOutFormat(next);
      if (next === 'DIGITAL') setOutPending(false);
    }
  }, [outAccountCurrencies, outCurrencyId, outFormat]);

  useEffect(() => {
    if (!quoteCurrencyId) return;
    setIns((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        const acs = inAccountCurrencies[line.key];
        if (!line.accountId || !acs?.length) return line;
        const allowed = allowedFormatsFromList(acs, quoteCurrencyId);
        if (allowed.length === 0) return line;
        const resolved = resolveFormat(allowed, line.format);
        const fmt = (resolved || allowed[0]) as string;
        const pending = fmt === 'CASH' ? line.pendingCash : false;
        if (fmt === line.format && pending === line.pendingCash) return line;
        changed = true;
        return { ...line, format: fmt, pendingCash: pending };
      });
      return changed ? next : prev;
    });
  }, [quoteCurrencyId, inAccountCurrencies]);

  function updateIn(key: number, patch: Partial<InLine>) {
    setIns((prev) => prev.map((i) => i.key === key ? { ...i, ...patch } : i));
    if (patch.accountId !== undefined) {
      setInAccountCurrencies((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  }

  function addInLine() {
    setIns((prev) => [...prev, { key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
  }

  function removeInLine(key: number) {
    if (ins.length <= 1) return;
    setIns((prev) => prev.filter((i) => i.key !== key));
  }

  useEffect(() => {
    if (ins.length !== 1) return;
    if (firstInAmountMode !== 'AUTO') return;
    if (!firstInKey) return;
    const targetAmount = debouncedEquivalent > 0 ? numberToNormalizedMoney(debouncedEquivalent, 2) : '';
    setIns((prev) => {
      const current = prev.find((i) => i.key === firstInKey);
      if (!current || current.amount === targetAmount) return prev;
      return prev.map((i) => i.key === firstInKey ? { ...i, amount: targetAmount } : i);
    });
  }, [debouncedEquivalent, firstInAmountMode, firstInKey, ins.length]);

  // If structure changes and we end up with one empty first line, re-enable AUTO mode.
  useEffect(() => {
    if (ins.length === 1 && firstInAmount === '' && firstInAmountMode !== 'AUTO') {
      setFirstInAmountMode('AUTO');
    }
  }, [ins.length, firstInAmount, firstInAmountMode]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<VentaDraftData>(movementId, 'VENTA')
      .then((draft) => {
        if (cancelled || !draft) return;
        setOutAccountId(draft.outAccountId || '');
        setOutCurrencyId(draft.outCurrencyId || '');
        setOutFormat(draft.outFormat || 'CASH');
        setOutAmount(draft.outAmount || '');
        setOutPending(Boolean(draft.outPending));
        setQuoteRate(draft.quoteRate || '');
        setQuoteCurrencyId(draft.quoteCurrencyId || '');
        setQuoteMode(normalizeQuoteMode(draft.quoteMode));
        setIns(
          draft.ins && draft.ins.length > 0
            ? draft.ins.map((i) => ({
                key: lineKeyCounter++,
                accountId: i.accountId || '',
                format: i.format || 'CASH',
                amount: i.amount || '',
                pendingCash: Boolean(i.pendingCash),
              }))
            : [{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }],
        );
        setFirstInAmountMode(draft.firstInAmountMode || 'AUTO');
        setDraftMessage('Borrador reanudado.');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  function canOutPending() {
    return outFormat === 'CASH';
  }

  function canInPending(inLine: InLine) {
    return inLine.format === 'CASH';
  }

  function validateInCurrencyOnAccount(inKey: number): boolean {
    const acs = inAccountCurrencies[inKey];
    if (!acs || !quoteCurrencyId) return false;
    const found = acs.find((ac) => ac.currency_id === quoteCurrencyId);
    if (!found) return false;
    const inLine = ins.find((i) => i.key === inKey);
    if (!inLine) return false;
    if (inLine.format === 'CASH') return found.cash_enabled;
    if (inLine.format === 'DIGITAL') return found.digital_enabled;
    return false;
  }

  async function handleSubmit() {
    setError('');

    if (!outAccountId || !outCurrencyId || !outAmount) { setError('Completá la sección de salida.'); return; }
    if (!quoteRate || !quoteCurrencyId) { setError('Completá la cotización.'); return; }
    if (parseFloat(outAmount) <= 0) { setError('Monto vendido debe ser mayor a 0.'); return; }
    if (parseFloat(quoteRate) <= 0) { setError('La cotización debe ser mayor a 0.'); return; }

    for (const inLine of ins) {
      if (!inLine.accountId || !inLine.amount) { setError('Completá todas las líneas de entrada.'); return; }
      if (parseFloat(inLine.amount) <= 0) { setError('Los montos de entrada deben ser mayores a 0.'); return; }
    }

    if (Math.round(diff * 100) / 100 !== 0) {
      setError(cuadreMsg || 'El cuadre no coincide.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/venta`, {
        out: {
          account_id: outAccountId,
          currency_id: outCurrencyId,
          format: outFormat,
          amount: outAmount,
          pending_cash: outPending && outFormat === 'CASH',
        },
        quote: {
          rate: quoteRate,
          currency_id: quoteCurrencyId,
          mode: normalizeQuoteMode(quoteMode),
        },
        ins: ins.map((i) => ({
          account_id: i.accountId,
          format: i.format,
          amount: i.amount,
          pending_cash: i.pendingCash && i.format === 'CASH',
        })),
      });
    } catch (err: any) {
      setError(err?.message || 'Error al guardar la venta.');
      return;
    } finally {
      setSubmitting(false);
    }
    onDone();
  }

  function buildDraftData(): VentaDraftData {
    return {
      outAccountId,
      outCurrencyId,
      outFormat,
      outAmount,
      outPending,
      quoteRate,
      quoteCurrencyId,
      quoteMode: normalizeQuoteMode(quoteMode),
      ins: ins.map((i) => ({
        accountId: i.accountId,
        format: i.format,
        amount: i.amount,
        pendingCash: i.pendingCash,
      })),
      firstInAmountMode,
    };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'VENTA', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setOutAccountId('');
    setOutCurrencyId('');
    setOutFormat('CASH');
    setOutAmount('');
    setOutPending(false);
    setOutAccountCurrencies([]);
    setQuoteRate('');
    setQuoteCurrencyId('');
    setQuoteMode('MULTIPLY');
    setIns([{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
    setInAccountCurrencies({});
    setFirstInAmountMode('AUTO');
  }

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-error text-sm">{error}</p>}
      {draftMessage && <p className="text-info text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-fg-muted text-sm">Cargando borrador...</p>}

      {/* SALIDA */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Salida (SALE)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
            <select value={outAccountId} onChange={(e) => { setOutAccountId(e.target.value); setOutCurrencyId(''); }} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
            <select value={outCurrencyId} onChange={(e) => setOutCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {outAccountCurrencies.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
            <select
              value={outFormat}
              onChange={(e) => {
                const v = e.target.value as MovementFormat;
                setOutFormat(v);
                if (v === 'DIGITAL') setOutPending(false);
              }}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              disabled={!outCurrencyId || outAllowedFormats.length === 0}
            >
              {outAllowedFormats.map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {outCurrencyId && outAllowedFormats.length === 0 && (
              <p className="text-xs text-error mt-1">Esta divisa no tiene formato habilitado en esta cuenta.</p>
            )}
          </div>
          <div>
            <MoneyInput label="Monto vendido" value={outAmount} onValueChange={setOutAmount} />
            {saleAmountVisualHint != null ? (
              <p className="text-xs text-fg-muted mt-1 leading-snug">
                Sugerencia: <span className="font-mono font-medium text-fg">{formatMoneyAR(saleAmountVisualHint)}</span> (no completa el campo)
              </p>
            ) : null}
          </div>
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" checked={outPending} onChange={(e) => setOutPending(e.target.checked)} disabled={!canOutPending()} />
          <span className={canOutPending() ? 'text-fg' : 'text-fg-subtle'}>Pendiente de entrega</span>
        </label>
      </fieldset>

      {/* COTIZACIÓN */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Cotización</legend>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <MoneyInput label="Cotización" value={quoteRate} onValueChange={setQuoteRate} fractionDigits={8} />
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa cotización</label>
            <select value={quoteCurrencyId} onChange={(e) => setQuoteCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {currencies.filter((c) => c.id !== outCurrencyId).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Modo de cotización</label>
            <select value={quoteMode} onChange={(e) => setQuoteMode(normalizeQuoteMode(e.target.value))} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="MULTIPLY">Multiplicar</option>
              <option value="DIVIDE">Dividir</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Equivalente</label>
            <p className="text-sm font-mono py-1.5 font-medium text-fg">
              {equivalent > 0 ? `${quoteCurrencyCode} ${formatMoneyAR(equivalent)}` : '—'}
            </p>
          </div>
        </div>
        {quoteInterpretation && <p className="mt-2 text-xs text-fg-muted">{quoteInterpretation}</p>}
      </fieldset>

      {/* ENTRADA */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Entrada (ENTRA)</legend>
        {ins.map((inLine, idx) => (
          <div key={inLine.key} className="border border-subtle rounded-lg p-3 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
              <span className="text-xs text-fg-subtle">Línea {idx + 1}</span>
              {ins.length > 1 && (
                <button onClick={() => removeInLine(inLine.key)} className="text-xs text-error hover:text-error">Quitar</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
                <select
                  value={inLine.accountId}
                  onChange={(e) => updateIn(inLine.key, { accountId: e.target.value })}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
                <input type="text" readOnly value={quoteCurrencyCode || '—'} className="w-full border border-subtle rounded px-2 py-1.5 text-sm bg-surface text-fg-muted" />
              </div>
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
                <select
                  value={inLine.format}
                  onChange={(e) => updateIn(inLine.key, { format: e.target.value, pendingCash: e.target.value === 'DIGITAL' ? false : inLine.pendingCash })}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                  disabled={!quoteCurrencyId || !inLine.accountId || allowedFormatsFromList(inAccountCurrencies[inLine.key], quoteCurrencyId).length === 0}
                >
                  {allowedFormatsFromList(inAccountCurrencies[inLine.key], quoteCurrencyId).map((f) => (
                    <option key={f} value={f}>{formatLabel(f)}</option>
                  ))}
                </select>
              </div>
              <MoneyInput
                label="Monto"
                value={inLine.amount}
                onValueChange={(v) => {
                  if (idx === 0) {
                    setFirstInAmountMode(resolveFirstLineAmountMode(v));
                  }
                  updateIn(inLine.key, { amount: v });
                }}
              />
            </div>
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input
                type="checkbox"
                checked={inLine.pendingCash}
                onChange={(e) => updateIn(inLine.key, { pendingCash: e.target.checked })}
                disabled={!canInPending(inLine)}
              />
              <span className={canInPending(inLine) ? 'text-fg' : 'text-fg-subtle'}>Pendiente de retiro</span>
            </label>
            {inLine.accountId && quoteCurrencyId && !validateInCurrencyOnAccount(inLine.key) && (
              <p className="text-xs text-error mt-1">La divisa/formato no está habilitada para esta cuenta.</p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addInLine}
          className="inline-flex min-h-[44px] items-center rounded-md px-2 text-sm text-info hover:bg-brand-soft hover:text-info"
        >
          + Agregar línea de entrada
        </button>
      </fieldset>

      {/* CUADRE */}
      {equivalent > 0 && (
        <div className="bg-surface border border-subtle rounded-lg p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <span className="shrink-0 text-fg-muted">Equivalente:</span>
            <span className="min-w-0 break-words font-mono font-medium text-right">{quoteCurrencyCode} {formatMoneyAR(equivalent)}</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <span className="shrink-0 text-fg-muted">Total entradas:</span>
            <span className="min-w-0 break-words font-mono font-medium text-right">{quoteCurrencyCode} {formatMoneyAR(inSum)}</span>
          </div>
          {cuadreMsg && (
            <p className={`mt-1 font-medium ${diff > 0 ? 'text-orange-600' : 'text-error'}`}>{cuadreMsg}</p>
          )}
          {!cuadreMsg && equivalent > 0 && inSum > 0 && (
            <p className="mt-1 text-success font-medium">Cuadre correcto</p>
          )}
        </div>
      )}

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
