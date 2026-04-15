import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api/client';
import MoneyInput from '../common/MoneyInput';
import { formatMoneyAR, roundHalfAwayFromZero, roundTo } from '../../utils/money';
import { calculateEquivalent, cuadreCompraOk, normalizeQuoteMode, type QuoteMode } from '../../utils/fx';
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

interface OutLine {
  key: number;
  accountId: string;
  format: string;
  amount: string;
  pendingCash: boolean;
}

let lineKeyCounter = 1;

interface CompraDraftOutLine {
  accountId: string;
  format: string;
  amount: string;
  pendingCash: boolean;
}

interface CompraDraftData {
  inAccountId: string;
  inCurrencyId: string;
  inFormat: string;
  inAmount: string;
  inPending: boolean;
  quoteRate: string;
  quoteCurrencyId: string;
  quoteMode: QuoteMode;
  outs: CompraDraftOutLine[];
  firstOutAmountMode: FirstLineAmountMode;
}

export default function CompraForm({ movementId, onDone, onCancel }: { movementId: string; onDone: () => void; onCancel: () => void }) {
  const accounts = useActiveAccounts();
  const currencies = useActiveCurrencies();

  // IN
  const [inAccountId, setInAccountId] = useState('');
  const [inCurrencyId, setInCurrencyId] = useState('');
  const [inFormat, setInFormat] = useState('CASH');
  const [inAmount, setInAmount] = useState('');
  const [inPending, setInPending] = useState(false);
  const [inAccountCurrencies, setInAccountCurrencies] = useState<AccountCurrency[]>([]);

  // Quote
  const [quoteRate, setQuoteRate] = useState('');
  const [quoteCurrencyId, setQuoteCurrencyId] = useState('');
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('MULTIPLY');

  // OUTs
  const [outs, setOuts] = useState<OutLine[]>([{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
  const [outAccountCurrencies, setOutAccountCurrencies] = useState<Record<number, AccountCurrency[]>>({});
  const [firstOutAmountMode, setFirstOutAmountMode] = useState<FirstLineAmountMode>('AUTO');

  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftLoading, setDraftLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftMessage, setDraftMessage] = useState('');

  useEffect(() => {
    if (!inAccountId) { setInAccountCurrencies([]); return; }
    api.get<AccountCurrency[]>(`/accounts/${inAccountId}/currencies`).then(setInAccountCurrencies).catch(() => setInAccountCurrencies([]));
  }, [inAccountId]);

  // Load account currencies for each OUT line
  useEffect(() => {
    outs.forEach((out) => {
      if (out.accountId && !outAccountCurrencies[out.key]) {
        api.get<AccountCurrency[]>(`/accounts/${out.accountId}/currencies`).then((acs) => {
          setOutAccountCurrencies((prev) => ({ ...prev, [out.key]: acs }));
        });
      }
    });
  }, [outs, outAccountCurrencies]);

  const equivalent = useMemo(() => {
    const a = parseFloat(inAmount);
    const r = parseFloat(quoteRate);
    return calculateEquivalent(a, r, quoteMode);
  }, [inAmount, quoteRate, quoteMode]);
  const debouncedEquivalent = useDebouncedValue(equivalent, 300);
  const firstOutKey = outs[0]?.key;
  const firstOutAmount = outs[0]?.amount || '';

  const outSum = useMemo(() => {
    return outs.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);
  }, [outs]);

  /** Ayuda visual (solo texto): invierte ×/÷ respecto al select (MULTIPLY → ÷, DIVIDE → ×). No modifica inputs ni `equivalent`. */
  const compraAmountVisualHint = useMemo(() => {
    const rate = parseFloat(String(quoteRate).trim().replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) return null;
    if (!Number.isFinite(outSum) || outSum <= 0) return null;
    const mode = normalizeQuoteMode(quoteMode);
    const raw = mode === 'MULTIPLY' ? outSum / rate : outSum * rate;
    return roundTo(raw, 2);
  }, [quoteRate, quoteMode, outSum]);

  const cuadreOk = useMemo(() => {
    const a = parseFloat(String(inAmount).trim().replace(',', '.'));
    const r = parseFloat(String(quoteRate).trim().replace(',', '.'));
    return cuadreCompraOk(
      Number.isFinite(a) ? a : 0,
      outSum,
      Number.isFinite(r) && r > 0 ? r : 0,
      normalizeQuoteMode(quoteMode),
      equivalent,
    );
  }, [inAmount, outSum, quoteRate, quoteMode, equivalent]);

  const equivalentRounded = roundHalfAwayFromZero(equivalent, 2);
  const outSumRounded = roundHalfAwayFromZero(outSum, 2);
  const diff = equivalentRounded - outSumRounded;
  const inCurrencyCode = currencies.find((c) => c.id === inCurrencyId)?.code || '';
  const quoteCurrencyCode = currencies.find((c) => c.id === quoteCurrencyId)?.code || '';
  const quoteRateLabel = useMemo(() => {
    const rate = parseFloat(quoteRate);
    if (isNaN(rate) || rate <= 0) return '—';
    return formatMoneyAR(rate, 8);
  }, [quoteRate]);
  const quoteInterpretation = useMemo(() => {
    if (!inCurrencyCode || !quoteCurrencyCode) return '';
    const op = quoteMode === 'DIVIDE' ? '/' : '*';
    return `Interpretación: ${quoteCurrencyCode} = ${inCurrencyCode} ${op} ${quoteRateLabel}`;
  }, [inCurrencyCode, quoteCurrencyCode, quoteMode, quoteRateLabel]);

  const inAllowedFormats = useMemo(
    () => allowedFormatsFromList(inAccountCurrencies, inCurrencyId),
    [inAccountCurrencies, inCurrencyId],
  );

  const cuadreMsg = useMemo(() => {
    if (equivalent === 0) return '';
    if (cuadreOk) return '';
    if (diff === 0) return '';
    if (diff > 0) return `Te falta ${formatMoneyAR(Math.abs(diff))} ${quoteCurrencyCode}`;
    return `Te sobra ${formatMoneyAR(Math.abs(diff))} ${quoteCurrencyCode}`;
  }, [diff, equivalent, quoteCurrencyCode, cuadreOk]);

  useEffect(() => {
    if (!inCurrencyId) return;
    const allowed = allowedFormatsFromList(inAccountCurrencies, inCurrencyId);
    if (allowed.length === 0) return;
    const next = resolveFormat(allowed, inFormat);
    if (next && next !== inFormat) {
      setInFormat(next);
      if (next === 'DIGITAL') setInPending(false);
    }
  }, [inAccountCurrencies, inCurrencyId, inFormat]);

  useEffect(() => {
    if (!quoteCurrencyId) return;
    setOuts((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        const acs = outAccountCurrencies[o.key];
        if (!o.accountId || !acs?.length) return o;
        const allowed = allowedFormatsFromList(acs, quoteCurrencyId);
        if (allowed.length === 0) return o;
        const resolved = resolveFormat(allowed, o.format);
        const fmt = (resolved || allowed[0]) as string;
        const pending = fmt === 'CASH' ? o.pendingCash : false;
        if (fmt === o.format && pending === o.pendingCash) return o;
        changed = true;
        return { ...o, format: fmt, pendingCash: pending };
      });
      return changed ? next : prev;
    });
  }, [quoteCurrencyId, outAccountCurrencies]);

  function updateOut(key: number, patch: Partial<OutLine>) {
    setOuts((prev) => prev.map((o) => o.key === key ? { ...o, ...patch } : o));
    if (patch.accountId !== undefined) {
      setOutAccountCurrencies((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  }

  function addOutLine() {
    setOuts((prev) => [...prev, { key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
  }

  function removeOutLine(key: number) {
    if (outs.length <= 1) return;
    setOuts((prev) => prev.filter((o) => o.key !== key));
  }

  // Keep first OUT line synced with equivalent while mode is AUTO.
  useEffect(() => {
    if (outs.length !== 1) return;
    if (firstOutAmountMode !== 'AUTO') return;
    if (!firstOutKey) return;
    const targetAmount = debouncedEquivalent > 0 ? String(roundHalfAwayFromZero(debouncedEquivalent, 2)) : '';
    setOuts((prev) => {
      const current = prev.find((o) => o.key === firstOutKey);
      if (!current || current.amount === targetAmount) return prev;
      return prev.map((o) => o.key === firstOutKey ? { ...o, amount: targetAmount } : o);
    });
  }, [debouncedEquivalent, firstOutAmountMode, firstOutKey, outs.length]);

  // If structure changes and we end up with one empty first line, re-enable AUTO mode.
  useEffect(() => {
    if (outs.length === 1 && firstOutAmount === '' && firstOutAmountMode !== 'AUTO') {
      setFirstOutAmountMode('AUTO');
    }
  }, [outs.length, firstOutAmount, firstOutAmountMode]);

  useEffect(() => {
    let cancelled = false;
    setDraftLoading(true);
    loadOperationDraft<CompraDraftData>(movementId, 'COMPRA')
      .then((draft) => {
        if (cancelled || !draft) return;
        setInAccountId(draft.inAccountId || '');
        setInCurrencyId(draft.inCurrencyId || '');
        setInFormat(draft.inFormat || 'CASH');
        setInAmount(draft.inAmount || '');
        setInPending(Boolean(draft.inPending));
        setQuoteRate(draft.quoteRate || '');
        setQuoteCurrencyId(draft.quoteCurrencyId || '');
        setQuoteMode(normalizeQuoteMode(draft.quoteMode));
        setOuts(
          draft.outs && draft.outs.length > 0
            ? draft.outs.map((o) => ({
                key: lineKeyCounter++,
                accountId: o.accountId || '',
                format: o.format || 'CASH',
                amount: o.amount || '',
                pendingCash: Boolean(o.pendingCash),
              }))
            : [{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }],
        );
        setFirstOutAmountMode(draft.firstOutAmountMode || 'AUTO');
        setDraftMessage('Borrador reanudado.');
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movementId]);

  function canInPending() {
    return inFormat === 'CASH';
  }

  function canOutPending(out: OutLine) {
    return out.format === 'CASH';
  }

  function validateOutCurrencyOnAccount(outKey: number): boolean {
    const acs = outAccountCurrencies[outKey];
    if (!acs || !quoteCurrencyId) return false;
    const found = acs.find((ac) => ac.currency_id === quoteCurrencyId);
    if (!found) return false;
    const out = outs.find((o) => o.key === outKey);
    if (!out) return false;
    if (out.format === 'CASH') return found.cash_enabled;
    if (out.format === 'DIGITAL') return found.digital_enabled;
    return false;
  }

  async function handleSubmit() {
    setError('');

    if (!inAccountId || !inCurrencyId || !inAmount) { setError('Completá la sección de entrada.'); return; }
    if (!quoteRate || !quoteCurrencyId) { setError('Completá la cotización.'); return; }
    if (parseFloat(inAmount) <= 0) { setError('Monto comprado debe ser mayor a 0.'); return; }
    if (parseFloat(quoteRate) <= 0) { setError('La cotización debe ser mayor a 0.'); return; }

    for (const out of outs) {
      if (!out.accountId || !out.amount) { setError('Completá todas las líneas de salida.'); return; }
      if (parseFloat(out.amount) <= 0) { setError('Los montos de salida deben ser mayores a 0.'); return; }
    }

    const a = parseFloat(String(inAmount).trim().replace(',', '.'));
    const r = parseFloat(String(quoteRate).trim().replace(',', '.'));
    if (
      !cuadreCompraOk(
        Number.isFinite(a) ? a : 0,
        outSum,
        Number.isFinite(r) && r > 0 ? r : 0,
        normalizeQuoteMode(quoteMode),
        equivalent,
      )
    ) {
      setError(cuadreMsg || 'El cuadre no coincide.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/movements/${movementId}/compra`, {
        in: {
          account_id: inAccountId,
          currency_id: inCurrencyId,
          format: inFormat,
          amount: inAmount,
          pending_cash: inPending && inFormat === 'CASH',
        },
        quote: {
          rate: quoteRate,
          currency_id: quoteCurrencyId,
          mode: normalizeQuoteMode(quoteMode),
        },
        outs: outs.map((o) => ({
          account_id: o.accountId,
          format: o.format,
          amount: o.amount,
          pending_cash: o.pendingCash && o.format === 'CASH',
        })),
      });
    } catch (err: any) {
      setError(err?.message || 'Error al guardar la compra.');
      return;
    } finally {
      setSubmitting(false);
    }
    onDone();
  }

  function buildDraftData(): CompraDraftData {
    return {
      inAccountId,
      inCurrencyId,
      inFormat,
      inAmount,
      inPending,
      quoteRate,
      quoteCurrencyId,
      quoteMode: normalizeQuoteMode(quoteMode),
      outs: outs.map((o) => ({
        accountId: o.accountId,
        format: o.format,
        amount: o.amount,
        pendingCash: o.pendingCash,
      })),
      firstOutAmountMode,
    };
  }

  async function handleSaveDraft() {
    setError('');
    setDraftMessage('');
    setSavingDraft(true);
    try {
      await saveOperationDraft(movementId, 'COMPRA', buildDraftData());
      setDraftMessage('Borrador guardado.');
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el borrador.');
    } finally {
      setSavingDraft(false);
    }
  }

  function handleClear() {
    setError('');
    setInAccountId('');
    setInCurrencyId('');
    setInFormat('CASH');
    setInAmount('');
    setInPending(false);
    setInAccountCurrencies([]);
    setQuoteRate('');
    setQuoteCurrencyId('');
    setQuoteMode('MULTIPLY');
    setOuts([{ key: lineKeyCounter++, accountId: '', format: 'CASH', amount: '', pendingCash: false }]);
    setOutAccountCurrencies({});
    setFirstOutAmountMode('AUTO');
  }

  return (
    <div className="border-t pt-4 space-y-6">
      {error && <p className="text-error text-sm">{error}</p>}
      {draftMessage && <p className="text-info text-sm">{draftMessage}</p>}
      {draftLoading && <p className="text-fg-muted text-sm">Cargando borrador...</p>}

      {/* ENTRADA */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Entrada (ENTRA)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
            <select value={inAccountId} onChange={(e) => { setInAccountId(e.target.value); setInCurrencyId(''); }} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Divisa</label>
            <select value={inCurrencyId} onChange={(e) => setInCurrencyId(e.target.value)} className="w-full border border-subtle rounded px-2 py-1.5 text-sm">
              <option value="">—</option>
              {inAccountCurrencies.map((ac) => <option key={ac.currency_id} value={ac.currency_id}>{ac.currency_code}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-muted mb-0.5">Formato</label>
            <select
              value={inFormat}
              onChange={(e) => {
                const v = e.target.value as MovementFormat;
                setInFormat(v);
                if (v === 'DIGITAL') setInPending(false);
              }}
              className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
              disabled={!inCurrencyId || inAllowedFormats.length === 0}
            >
              {inAllowedFormats.map((f) => (
                <option key={f} value={f}>{formatLabel(f)}</option>
              ))}
            </select>
            {inCurrencyId && inAllowedFormats.length === 0 && (
              <p className="text-xs text-error mt-1">Esta divisa no tiene formato habilitado en esta cuenta.</p>
            )}
          </div>
          <MoneyInput label="Monto comprado" value={inAmount} onValueChange={setInAmount} />
          {compraAmountVisualHint != null ? (
            <p className="text-xs text-fg-muted mt-1 leading-snug col-span-full">
              Sugerencia: <span className="font-mono font-medium text-fg">{formatMoneyAR(compraAmountVisualHint)}</span> (no completa el campo)
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" checked={inPending} onChange={(e) => setInPending(e.target.checked)} disabled={!canInPending()} />
          <span className={canInPending() ? 'text-fg' : 'text-fg-subtle'}>Pendiente de retiro</span>
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
              {currencies.filter((c) => c.id !== inCurrencyId).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
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

      {/* SALIDA */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-2">Salida (SALE)</legend>
        {outs.map((out, idx) => (
          <div key={out.key} className="border border-subtle rounded-lg p-3 mb-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 min-w-0">
              <span className="text-xs text-fg-subtle">Línea {idx + 1}</span>
              {outs.length > 1 && (
                <button onClick={() => removeOutLine(out.key)} className="text-xs text-error hover:text-error">Quitar</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
                <select
                  value={out.accountId}
                  onChange={(e) => updateOut(out.key, { accountId: e.target.value })}
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
                  value={out.format}
                  onChange={(e) => updateOut(out.key, { format: e.target.value, pendingCash: e.target.value === 'DIGITAL' ? false : out.pendingCash })}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                  disabled={!quoteCurrencyId || !out.accountId || allowedFormatsFromList(outAccountCurrencies[out.key], quoteCurrencyId).length === 0}
                >
                  {allowedFormatsFromList(outAccountCurrencies[out.key], quoteCurrencyId).map((f) => (
                    <option key={f} value={f}>{formatLabel(f)}</option>
                  ))}
                </select>
              </div>
              <MoneyInput
                label="Monto"
                value={out.amount}
                onValueChange={(v) => {
                  if (idx === 0) {
                    setFirstOutAmountMode(resolveFirstLineAmountMode(v));
                  }
                  updateOut(out.key, { amount: v });
                }}
              />
            </div>
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input
                type="checkbox"
                checked={out.pendingCash}
                onChange={(e) => updateOut(out.key, { pendingCash: e.target.checked })}
                disabled={!canOutPending(out)}
              />
              <span className={canOutPending(out) ? 'text-fg' : 'text-fg-subtle'}>Pendiente de pago</span>
            </label>
            {out.accountId && quoteCurrencyId && !validateOutCurrencyOnAccount(out.key) && (
              <p className="text-xs text-error mt-1">La divisa/formato no está habilitada para esta cuenta.</p>
            )}
          </div>
        ))}
        <button onClick={addOutLine} className="text-sm text-info hover:text-info transition">
          + Agregar línea de salida
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
            <span className="shrink-0 text-fg-muted">Total salidas:</span>
            <span className="min-w-0 break-words font-mono font-medium text-right">{quoteCurrencyCode} {formatMoneyAR(outSum)}</span>
          </div>
          {cuadreMsg && (
            <p className={`mt-1 font-medium ${diff > 0 ? 'text-orange-600' : 'text-error'}`}>{cuadreMsg}</p>
          )}
          {cuadreOk && equivalent > 0 && outSum > 0 && (
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
