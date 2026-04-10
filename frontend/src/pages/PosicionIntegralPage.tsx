import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatMoneyAR } from '../utils/money';
import { isPendingUserFacingRetiro } from '../utils/pendingTypeLabels';

const LS_COTIZ_USD = 'fina-cotizacion-usd';

function readCotizFromStorage(): string {
  try {
    const v = localStorage.getItem(LS_COTIZ_USD);
    return v != null && v !== '' ? v : '';
  } catch {
    return '';
  }
}

interface Account {
  id: string;
  name: string;
  active: boolean;
}

interface CCBalanceSummary {
  client_id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  balances: Array<{ currency_id: string; currency_code: string; balance: string }>;
}

interface CashPositionAccount {
  account_id: string;
  account_name: string;
  balances: Array<{
    currency_id: string;
    currency_code: string;
    format: string;
    balance: string;
  }>;
}

interface SystemTotal {
  currency_id: string;
  currency_code: string;
  format: string;
  balance: string;
}

interface MovementListItem {
  id: string;
  operation_number: number;
  type: string;
  date: string;
  status: string;
  client_name: string | null;
  resumen: string;
  summary_items?: Array<{ side: string; currency_code: string; amount: string }>;
}

interface MovementListResult {
  items: MovementListItem[];
  total: number;
  page: number;
  limit: number;
}

/** Campos mínimos de `/pendientes` para sumar retiros en USD. */
interface PendingListRow {
  type: string;
  movement_type?: string;
  currency_code: string;
  amount: string;
  status: string;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseAmt(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** `arsPerUsd`: ARS por 1 USD. */
function amountToUsd(currencyCode: string, amount: number, arsPerUsd: number): number {
  const c = currencyCode.trim().toUpperCase();
  if (c === 'USD') return amount;
  if (!arsPerUsd || arsPerUsd <= 0) return 0;
  if (c === 'ARS') return amount / arsPerUsd;
  return 0;
}

function normalizeTotalsFromSystemAPI(raw: unknown[]): SystemTotal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    const fmt = r.format ?? r.Format;
    return {
      currency_id: String(r.currency_id ?? ''),
      currency_code: String(r.currency_code ?? ''),
      format: typeof fmt === 'string' ? fmt : '',
      balance: String(r.balance ?? '0'),
    };
  });
}

async function aggregateSystemCashPhysical(asOf: string): Promise<SystemTotal[]> {
  let accounts: Account[] = [];
  try {
    accounts = await api.get<Account[]>('/accounts');
  } catch {
    return [];
  }
  const map = new Map<string, SystemTotal>();
  for (const acc of (accounts || []).filter((a) => a.active)) {
    try {
      const res = await api.get<{ totals: unknown[] }>(
        `/cash-arqueos/system-totals?account_id=${encodeURIComponent(acc.id)}&as_of=${encodeURIComponent(asOf)}`
      );
      const rows = normalizeTotalsFromSystemAPI(res.totals || []).filter(
        (t) => String(t.format).trim().toUpperCase() === 'CASH',
      );
      for (const row of rows) {
        const key = `${row.currency_id}|CASH`;
        const prev = parseAmt(map.get(key)?.balance);
        const add = parseAmt(row.balance);
        map.set(key, {
          currency_id: row.currency_id,
          currency_code: row.currency_code,
          format: 'CASH',
          balance: String(prev + add),
        });
      }
    } catch {
      /* cuenta sin acceso o error */
    }
  }
  return Array.from(map.values());
}

async function fetchAllMovementsForRange(
  dateFrom: string,
  dateTo: string,
  type: string,
): Promise<MovementListItem[]> {
  const limit = 100;
  let page = 1;
  const out: MovementListItem[] = [];
  for (;;) {
    const q = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      date_from: dateFrom,
      date_to: dateTo,
      type,
      sort_by: 'date',
      sort_dir: 'desc',
    });
    const res = await api.get<MovementListResult>(`/movements?${q.toString()}`);
    const items = res.items || [];
    out.push(...items);
    if (items.length < limit || out.length >= (res.total ?? 0)) break;
    page += 1;
    if (page > 500) break;
  }
  return out;
}

function movementOutflowUsd(m: MovementListItem, arsPerUsd: number): number {
  const items = m.summary_items || [];
  const outs = items.filter((x) => x.side === 'OUT');
  const use = outs.length ? outs : items.filter((x) => x.side === 'IN');
  let sum = 0;
  for (const x of use) {
    sum += amountToUsd(x.currency_code, parseAmt(x.amount), arsPerUsd);
  }
  return sum;
}

export default function PosicionIntegralPage() {
  const [asOfDate, setAsOfDate] = useState(todayStr);
  const [cotizInput, setCotizInput] = useState(() => readCotizFromStorage());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [ccRows, setCcRows] = useState<CCBalanceSummary[]>([]);
  const [cashPos, setCashPos] = useState<CashPositionAccount[]>([]);
  const [physicalTotals, setPhysicalTotals] = useState<SystemTotal[]>([]);
  const [pendRetiroRows, setPendRetiroRows] = useState<PendingListRow[]>([]);
  const [movGastos, setMovGastos] = useState<MovementListItem[]>([]);

  const arsPerUsd = useMemo(() => parseAmt(cotizInput), [cotizInput]);

  const persistCotiz = useCallback((v: string) => {
    setCotizInput(v);
    try {
      localStorage.setItem(LS_COTIZ_USD, v);
    } catch {
      /* ignore */
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const d = asOfDate;
    try {
      const [cc, pos, phys, pendAll, gastosAll] = await Promise.all([
        api.get<CCBalanceSummary[]>('/cc-balances').catch(() => [] as CCBalanceSummary[]),
        api.get<CashPositionAccount[]>(`/cash-position?as_of=${encodeURIComponent(d)}`).catch(() => []),
        aggregateSystemCashPhysical(d),
        api.get<PendingListRow[]>('/pendientes').catch(() => [] as PendingListRow[]),
        fetchAllMovementsForRange(d, d, 'GASTO').catch(() => [] as MovementListItem[]),
      ]);

      setCcRows(Array.isArray(cc) ? cc : []);
      setCashPos(Array.isArray(pos) ? pos : []);
      setPhysicalTotals(phys);
      const pend = Array.isArray(pendAll) ? pendAll : [];
      setPendRetiroRows(
        pend.filter(
          (p) => p.status === 'ABIERTO' && isPendingUserFacingRetiro(p.type, p.movement_type),
        ),
      );
      setMovGastos(gastosAll);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || 'Error al cargar datos.');
    } finally {
      setLoading(false);
    }
  }, [asOfDate]);

  useEffect(() => {
    void loadData();
    // Solo carga inicial; Actualizar vuelve a llamar loadData manualmente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retirosPendUsd = useMemo(
    () =>
      pendRetiroRows.reduce(
        (acc, p) => acc + amountToUsd(p.currency_code, Math.abs(parseAmt(p.amount)), arsPerUsd),
        0,
      ),
    [pendRetiroRows, arsPerUsd],
  );

  const gastosPeriodoUsd = useMemo(
    () => movGastos.reduce((acc, m) => acc + movementOutflowUsd(m, arsPerUsd), 0),
    [movGastos, arsPerUsd],
  );

  const digitalUsd = useMemo(() => {
    let s = 0;
    for (const acc of cashPos) {
      for (const b of acc.balances || []) {
        if (String(b.format).toUpperCase() !== 'DIGITAL') continue;
        s += amountToUsd(b.currency_code, parseAmt(b.balance), arsPerUsd);
      }
    }
    return s;
  }, [cashPos, arsPerUsd]);

  const physicalUsd = useMemo(
    () =>
      physicalTotals.reduce((acc, t) => acc + amountToUsd(t.currency_code, parseAmt(t.balance), arsPerUsd), 0),
    [physicalTotals, arsPerUsd],
  );

  const totalBrutoUsd = physicalUsd + digitalUsd;

  const deudaCcNetaUsd = useMemo(() => {
    let s = 0;
    for (const c of ccRows) {
      for (const b of c.balances || []) {
        s += amountToUsd(b.currency_code, parseAmt(b.balance), arsPerUsd);
      }
    }
    return s;
  }, [ccRows, arsPerUsd]);

  const capitalPropioUsd = totalBrutoUsd + deudaCcNetaUsd - retirosPendUsd;

  const ccFlatRows = useMemo(() => {
    const rows: Array<{
      key: string;
      clientLabel: string;
      currencyCode: string;
      balance: number;
      usd: number;
    }> = [];
    for (const c of ccRows) {
      const label = `#${c.client_code} — ${c.last_name}, ${c.first_name}`;
      for (const b of c.balances || []) {
        const bal = parseAmt(b.balance);
        rows.push({
          key: `${c.client_id}-${b.currency_id}`,
          clientLabel: label,
          currencyCode: b.currency_code,
          balance: bal,
          usd: amountToUsd(b.currency_code, bal, arsPerUsd),
        });
      }
    }
    return rows;
  }, [ccRows, arsPerUsd]);

  const ccTotalUsd = ccFlatRows.reduce((a, r) => a + r.usd, 0);

  const cashDigitalRows: typeof ccFlatRows = [];
  const cashEfectivoRows: typeof ccFlatRows = [];
  for (const acc of cashPos) {
    for (const b of acc.balances || []) {
      const fmt = String(b.format).toUpperCase();
      const bal = parseAmt(b.balance);
      const row = {
        key: `${acc.account_id}-${b.currency_id}-${b.format}`,
        clientLabel: acc.account_name,
        currencyCode: b.currency_code,
        balance: bal,
        usd: amountToUsd(b.currency_code, bal, arsPerUsd),
      };
      if (fmt === 'DIGITAL') cashDigitalRows.push(row);
      else if (fmt === 'CASH') cashEfectivoRows.push(row);
    }
  }

  function subtotalUsd(rows: typeof ccFlatRows) {
    return rows.reduce((a, r) => a + r.usd, 0);
  }

  const physicalByCurrency = useMemo(() => {
    const m = new Map<string, { code: string; amount: number; usd: number }>();
    for (const t of physicalTotals) {
      const code = t.currency_code || '?';
      const amt = parseAmt(t.balance);
      const prev = m.get(code) || { code, amount: 0, usd: 0 };
      prev.amount += amt;
      prev.usd += amountToUsd(code, amt, arsPerUsd);
      m.set(code, prev);
    }
    return Array.from(m.values());
  }, [physicalTotals, arsPerUsd]);

  const physicalGrandUsd = physicalByCurrency.reduce((a, x) => a + x.usd, 0);

  function usdCell(code: string, usd: number) {
    return code.toUpperCase() === 'EUR' ? '—' : formatMoneyAR(usd);
  }

  return (
    <div className="space-y-8">
      <div className="card-surface space-y-4">
        <h2 className="text-xl font-semibold text-fg">Posición integral</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-0.5">Fecha</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="input-field w-auto"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-muted mb-0.5">Cotización USD (ARS por 1 USD)</label>
            <input
              type="text"
              inputMode="decimal"
              value={cotizInput}
              onChange={(e) => persistCotiz(e.target.value)}
              className="input-field max-w-[12rem]"
              placeholder="Ej. 1200"
            />
          </div>
          <button type="button" className="btn-primary" onClick={() => void loadData()} disabled={loading}>
            Actualizar
          </button>
        </div>
        <div className="text-xs text-fg-muted space-y-1.5 max-w-3xl">
          <p>
            <strong className="text-fg-muted">Retiros pendientes (USD):</strong> suma de pendientes{' '}
            <strong>abiertos</strong> (mismo origen que la pantalla Pendientes) cuya etiqueta allí es «Retiro».
            EUR en USD: — hasta definir tipo cruzado.
          </p>
          <p className="font-medium text-fg-muted">Avisos:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>No incluye filas etiquetadas como «Entrega» (p. ej. en VENTA, entrega de divisa vendida).</li>
            <li>
              Incluye todos los pendientes abiertos vigentes; la fecha de arriba no filtra esta tarjeta (sí caja/CC,
              físico y gastos del día).
            </li>
            <li>
              Capital propio resta este total; al usar el criterio «Retiro» de Pendientes el monto puede ser mayor
              que el que había con solo RETIRO_CAPITAL.
            </li>
          </ul>
        </div>
      </div>

      {error ? <p className="text-error text-sm">{error}</p> : null}
      {loading ? <p className="text-fg-muted text-sm">Cargando…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Total físico (USD)</h3>
          <p className="text-lg font-semibold text-fg">{formatMoneyAR(physicalUsd)}</p>
        </div>
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Total digital (USD)</h3>
          <p className="text-lg font-semibold text-fg">{formatMoneyAR(digitalUsd)}</p>
        </div>
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Total bruto</h3>
          <p className="text-lg font-semibold text-fg">{formatMoneyAR(totalBrutoUsd)}</p>
        </div>
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Deuda CC neta (USD)</h3>
          <p className={`text-lg font-semibold ${deudaCcNetaUsd >= 0 ? 'text-success' : 'text-error'}`}>
            {formatMoneyAR(deudaCcNetaUsd)}
          </p>
        </div>
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Retiros pendientes (USD)</h3>
          <p className="text-lg font-semibold text-fg">{formatMoneyAR(retirosPendUsd)}</p>
        </div>
        <div className="card-surface">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Gastos del período (USD)</h3>
          <p className="text-lg font-semibold text-fg">{formatMoneyAR(gastosPeriodoUsd)}</p>
        </div>
        <div
          className={`card-surface sm:col-span-2 xl:col-span-2 border-2 ${
            capitalPropioUsd >= 0 ? 'border-success/40' : 'border-error/40'
          }`}
        >
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Capital propio (USD)</h3>
          <p className="text-xl font-bold text-fg mb-2">{formatMoneyAR(capitalPropioUsd)}</p>
          <span className={capitalPropioUsd >= 0 ? 'badge-success' : 'badge-error'}>
            {capitalPropioUsd >= 0 ? 'Positivo' : 'Negativo'}
          </span>
        </div>
      </div>

      <div className="card-surface space-y-3">
        <h3 className="text-h3 text-fg">Cuentas corrientes</h3>
        {!loading && ccFlatRows.length === 0 ? (
          <p className="text-fg-muted text-sm">Sin datos</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Moneda</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="px-3 py-2 text-right">En USD</th>
                </tr>
              </thead>
              <tbody>
                {ccFlatRows.map((r) => (
                  <tr key={r.key} className="border-b border-subtle/80 last:border-0">
                    <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                    <td className="px-3 py-2 font-medium text-fg">{r.currencyCode}</td>
                    <td className={`px-3 py-2 text-right font-mono ${r.balance >= 0 ? 'text-success' : 'text-error'}`}>
                      {formatMoneyAR(r.balance)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-fg">{usdCell(r.currencyCode, r.usd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t border-subtle bg-surface">
                  <td className="px-3 py-2 text-fg" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-fg">{formatMoneyAR(ccTotalUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card-surface space-y-4">
        <h3 className="text-h3 text-fg">Posición de caja</h3>
        {!loading && cashPos.length === 0 ? (
          <p className="text-fg-muted text-sm">Sin datos</p>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-fg-muted">Efectivo</h4>
            {cashEfectivoRows.length === 0 ? (
              <p className="text-fg-muted text-sm">Sin datos</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                      <th className="px-3 py-2">Cuenta</th>
                      <th className="px-3 py-2">Moneda</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-right">En USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashEfectivoRows.map((r) => (
                      <tr key={r.key} className="border-b border-subtle/80 last:border-0">
                        <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                        <td className="px-3 py-2 font-medium text-fg">{r.currencyCode}</td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{formatMoneyAR(r.balance)}</td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{usdCell(r.currencyCode, r.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold border-t border-subtle bg-surface">
                      <td className="px-3 py-2" colSpan={3}>
                        Subtotal efectivo (USD)
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(subtotalUsd(cashEfectivoRows))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <h4 className="text-sm font-semibold text-fg-muted">Digital</h4>
            {cashDigitalRows.length === 0 ? (
              <p className="text-fg-muted text-sm">Sin datos</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                      <th className="px-3 py-2">Cuenta</th>
                      <th className="px-3 py-2">Moneda</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-right">En USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashDigitalRows.map((r) => (
                      <tr key={r.key} className="border-b border-subtle/80 last:border-0">
                        <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                        <td className="px-3 py-2 font-medium text-fg">{r.currencyCode}</td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{formatMoneyAR(r.balance)}</td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{usdCell(r.currencyCode, r.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold border-t border-subtle bg-surface">
                      <td className="px-3 py-2" colSpan={3}>
                        Subtotal digital (USD)
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(subtotalUsd(cashDigitalRows))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card-surface space-y-3">
        <h3 className="text-h3 text-fg">Arqueo físico (saldos sistema CASH)</h3>
        <p className="text-xs text-fg-muted">
          Consolidado al <strong>{asOfDate}</strong> sumando <code className="text-fg-muted">system-totals</code> por
          cuenta (solo filas CASH).
        </p>
        {!loading && physicalByCurrency.length === 0 ? (
          <p className="text-fg-muted text-sm">Sin datos</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full min-w-[400px] text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                  <th className="px-3 py-2">Moneda</th>
                  <th className="px-3 py-2 text-right">Total (original)</th>
                  <th className="px-3 py-2 text-right">En USD</th>
                </tr>
              </thead>
              <tbody>
                {physicalByCurrency.map((r) => (
                  <tr key={r.code} className="border-b border-subtle/80 last:border-0">
                    <td className="px-3 py-2 font-medium text-fg">{r.code}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg">{formatMoneyAR(r.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono text-fg">{usdCell(r.code, r.usd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold border-t border-subtle bg-surface">
                  <td className="px-3 py-2">Total USD</td>
                  <td className="px-3 py-2 text-right font-mono" colSpan={2}>
                    {formatMoneyAR(physicalGrandUsd)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
