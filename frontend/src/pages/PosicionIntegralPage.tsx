import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Big from 'big.js';
import { formatMoneyAR, normalizeMoneyInput } from '../utils/money';
import { formatDate, todayLocalIsoDate, toLocalIsoDate } from '../utils/dateFormat';
import { isPendingUserFacingRetiro, isPendingUserFacingEntrega } from '../utils/pendingTypeLabels';
import type { ReportData, ReportMetricKey } from '../types/reportes';
import { EmptyState } from '../components/common/EmptyState';
import { SkeletonCard, SkeletonTable } from '../components/common/Skeleton';

const LS_COTIZ_USD = 'fina-cotizacion-usd';

/** Tooltip A-13: aclara diferencia vs. fila «Gastos» del reporte por rango/conversión. */
const GASTOS_DIA_MOVIMIENTOS_TOOLTIP =
  'Suma de gastos CONFIRMADOS del día de corte, convertidos a USD con la cotización manual. Puede diferir de la fila «Gastos» del reporte por el rango de fechas y por diferencias de conversión o de agregación.';

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

/** Campos de `/pendientes` (mismo contrato que PendientesPage: `id` obligatorio). */
interface PendingListRow {
  id: string;
  type: string;
  movement_type?: string;
  currency_code: string;
  amount: string;
  status: string;
  client_name?: string;
  operation_number?: number;
}

/** Si hay coma, miles/decimales es-AR vía normalizeMoneyInput; si no, decimal con punto (típico API). */
function moneyStringToNorm(s: string): string {
  const t = String(s).trim();
  if (t === '') return '0';
  if (t.includes(',')) return normalizeMoneyInput(t);
  const cleaned = t.replace(/[^0-9.-]/g, '');
  return cleaned === '' ? '0' : cleaned;
}

function safeBigFromMoney(s: string | undefined): Big {
  try {
    return new Big(moneyStringToNorm(s ?? '0'));
  } catch {
    return new Big(0);
  }
}

/** Monto monetario desde string (sumas y display); lectura con Big.js. */
function parseAmt(s: string | undefined): number {
  try {
    return safeBigFromMoney(s).toNumber();
  } catch {
    return 0;
  }
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
        `/cash-arqueos/system-totals?account_id=${encodeURIComponent(acc.id)}&as_of=${encodeURIComponent(asOf)}`,
      );
      const rows = normalizeTotalsFromSystemAPI(res.totals || []).filter(
        (t) => String(t.format).trim().toUpperCase() === 'CASH',
      );
      for (const row of rows) {
        const key = `${row.currency_id}|CASH`;
        const merged = safeBigFromMoney(map.get(key)?.balance).plus(safeBigFromMoney(row.balance));
        map.set(key, {
          currency_id: row.currency_id,
          currency_code: row.currency_code,
          format: 'CASH',
          balance: merged.toString(),
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
  let sum = new Big(0);
  for (const x of use) {
    sum = sum.plus(new Big(String(amountToUsd(x.currency_code, parseAmt(x.amount), arsPerUsd))));
  }
  return sum.toNumber();
}

type Periodo = 'dia' | 'semana' | 'mes';

function periodoRange(asOfDate: string, periodo: Periodo): { from: string; to: string } {
  if (periodo === 'dia') return { from: asOfDate, to: asOfDate };
  if (periodo === 'mes') {
    const from = `${asOfDate.slice(0, 8)}01`;
    return { from, to: asOfDate };
  }
  const d = new Date(`${asOfDate}T12:00:00`);
  const dow = d.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diffToMonday);
  const from = toLocalIsoDate(d);
  return { from, to: asOfDate };
}

function currencySummary(rows: Array<{ currencyCode: string; balance: number }>): string {
  const m = new Map<string, Big>();
  for (const r of rows) {
    const code = (r.currencyCode || '').trim() || '?';
    const cur = m.get(code) ?? new Big(0);
    m.set(code, cur.plus(new Big(String(r.balance))));
  }
  const parts = Array.from(m.entries())
    .filter(([, v]) => v.abs().gt(0.0005))
    .map(([code, amt]) => `${code} ${formatMoneyAR(amt.toNumber())}`);
  return parts.length ? parts.join(' · ') : '—';
}

function sumMetricUsd(
  section: { by_currency?: Array<{ currency_code: string; amount: string }> } | undefined,
  arsPer: number,
): number {
  let acc = new Big(0);
  for (const row of section?.by_currency ?? []) {
    const code = row.currency_code || '';
    const n = parseAmt(row.amount);
    acc = acc.plus(new Big(String(amountToUsd(code, n, arsPer))));
  }
  return acc.toNumber();
}

function Disclosure({
  id,
  title,
  subtitle,
  totalLabel,
  totalValue,
  children,
  defaultOpen = false,
  totalValueClassName,
}: {
  id: string;
  title: string;
  subtitle?: string;
  totalLabel: string;
  totalValue: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Opcional: énfasis en el total (p. ej. gastos / resultado). */
  totalValueClassName?: string;
}) {
  return (
    <details
      id={id}
      className="rounded-lg border border-subtle bg-elevated overflow-hidden group"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-surface/80 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-fg block">{title}</span>
          {subtitle ? <span className="text-xs text-fg-muted block mt-0.5">{subtitle}</span> : null}
        </span>
        <span className="text-right shrink-0">
          <span className="text-xs text-fg-muted block">{totalLabel}</span>
          <span className={`text-lg font-mono font-semibold ${totalValueClassName ?? 'text-fg'}`}>{totalValue}</span>
        </span>
        <span className="text-fg-muted text-sm w-full sm:w-auto sm:ml-2 group-open:hidden">Desplegar detalle</span>
        <span className="text-fg-muted text-sm w-full sm:w-auto sm:ml-2 hidden group-open:inline">Ocultar</span>
      </summary>
      <div className="border-t border-subtle px-4 py-3 bg-surface/40">{children}</div>
    </details>
  );
}

const REPORT_METRIC_LABELS: Record<ReportMetricKey, string> = {
  utilidad: 'Utilidad (compra-venta)',
  profit: 'Comisiones / Profit',
  gastos: 'Gastos',
  resultado: 'Resultado neto',
};

const REPORT_METRIC_ORDER: ReportMetricKey[] = ['utilidad', 'profit', 'gastos', 'resultado'];

export default function PosicionIntegralPage() {
  const { can } = useAuth();
  const canReportes = can('reportes.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);

  const [asOfDate, setAsOfDate] = useState(() => todayLocalIsoDate());
  const [cotizInput, setCotizInput] = useState(() => readCotizFromStorage());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('dia');

  const [ccRows, setCcRows] = useState<CCBalanceSummary[]>([]);
  const [cashPos, setCashPos] = useState<CashPositionAccount[]>([]);
  const [physicalTotals, setPhysicalTotals] = useState<SystemTotal[]>([]);
  const [pendRetiroRows, setPendRetiroRows] = useState<PendingListRow[]>([]);
  const [pendEntregaRows, setPendEntregaRows] = useState<PendingListRow[]>([]);
  const [movGastos, setMovGastos] = useState<MovementListItem[]>([]);

  const [reporteDia, setReporteDia] = useState<ReportData | null>(null);
  const [reporteSemana, setReporteSemana] = useState<ReportData | null>(null);
  const [reporteMes, setReporteMes] = useState<ReportData | null>(null);

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
      const rangeDia = periodoRange(d, 'dia');
      const rangeSemana = periodoRange(d, 'semana');
      const rangeMes = periodoRange(d, 'mes');

      const [cc, pos, phys, pendAll, gastosAll, rDia, rSemana, rMes] = await Promise.all([
        api.get<CCBalanceSummary[]>('/cc-balances').catch(() => [] as CCBalanceSummary[]),
        api.get<CashPositionAccount[]>(`/cash-position?as_of=${encodeURIComponent(d)}`).catch(() => []),
        aggregateSystemCashPhysical(d),
        api.get<PendingListRow[]>('/pendientes').catch(() => [] as PendingListRow[]),
        fetchAllMovementsForRange(d, d, 'GASTO').catch(() => [] as MovementListItem[]),
        canReportes
          ? api
              .get<ReportData>(
                `/reportes?from=${encodeURIComponent(rangeDia.from)}&to=${encodeURIComponent(rangeDia.to)}`,
              )
              .catch(() => null)
          : Promise.resolve(null),
        canReportes
          ? api
              .get<ReportData>(
                `/reportes?from=${encodeURIComponent(rangeSemana.from)}&to=${encodeURIComponent(rangeSemana.to)}`,
              )
              .catch(() => null)
          : Promise.resolve(null),
        canReportes
          ? api
              .get<ReportData>(
                `/reportes?from=${encodeURIComponent(rangeMes.from)}&to=${encodeURIComponent(rangeMes.to)}`,
              )
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      setCcRows(Array.isArray(cc) ? cc : []);
      setCashPos(Array.isArray(pos) ? pos : []);
      setPhysicalTotals(phys);
      const pend = Array.isArray(pendAll) ? pendAll : [];
      setPendRetiroRows(
        pend.filter((p) => p.status === 'ABIERTO' && isPendingUserFacingRetiro(p.type, p.movement_type)),
      );
      setPendEntregaRows(
        pend.filter((p) => p.status === 'ABIERTO' && isPendingUserFacingEntrega(p.type, p.movement_type)),
      );
      setMovGastos(Array.isArray(gastosAll) ? gastosAll : []);
      setReporteDia(rDia);
      setReporteSemana(rSemana);
      setReporteMes(rMes);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || 'Error al cargar datos.');
    } finally {
      setLoading(false);
    }
  }, [asOfDate, canReportes]);

  useEffect(() => {
    void loadData();
    // Solo carga inicial; Actualizar vuelve a llamar loadData manualmente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retirosPendUsd = useMemo(
    () =>
      pendRetiroRows
        .reduce(
          (acc, p) =>
            acc.plus(new Big(String(amountToUsd(p.currency_code, Math.abs(parseAmt(p.amount)), arsPerUsd)))),
          new Big(0),
        )
        .toNumber(),
    [pendRetiroRows, arsPerUsd],
  );

  const entregasPendUsd = useMemo(
    () =>
      pendEntregaRows
        .reduce(
          (acc, p) =>
            acc.plus(new Big(String(amountToUsd(p.currency_code, Math.abs(parseAmt(p.amount)), arsPerUsd)))),
          new Big(0),
        )
        .toNumber(),
    [pendEntregaRows, arsPerUsd],
  );

  const gastosPeriodoUsd = useMemo(() => {
    const confirmed = movGastos.filter((m) => m.status === 'CONFIRMADA');
    return confirmed
      .reduce((acc, m) => acc.plus(new Big(String(movementOutflowUsd(m, arsPerUsd)))), new Big(0))
      .toNumber();
  }, [movGastos, arsPerUsd]);

  const digitalUsd = useMemo(() => {
    let s = new Big(0);
    for (const acc of cashPos) {
      for (const b of acc.balances || []) {
        if (String(b.format).toUpperCase() !== 'DIGITAL') continue;
        s = s.plus(new Big(String(amountToUsd(b.currency_code, parseAmt(b.balance), arsPerUsd))));
      }
    }
    return s.toNumber();
  }, [cashPos, arsPerUsd]);

  const physicalUsd = useMemo(
    () =>
      physicalTotals
        .reduce(
          (acc, t) => acc.plus(new Big(String(amountToUsd(t.currency_code, parseAmt(t.balance), arsPerUsd)))),
          new Big(0),
        )
        .toNumber(),
    [physicalTotals, arsPerUsd],
  );

  const totalBrutoUsd = physicalUsd + digitalUsd;

  const deudaCcNetaUsd = useMemo(() => {
    let s = new Big(0);
    for (const c of ccRows) {
      for (const b of c.balances || []) {
        s = s.plus(new Big(String(amountToUsd(b.currency_code, parseAmt(b.balance), arsPerUsd))));
      }
    }
    return s.toNumber();
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

  const ccTotalUsd = ccFlatRows.reduce((a, r) => a.plus(new Big(String(r.usd))), new Big(0)).toNumber();

  const { cashDigitalRows, cashEfectivoRows } = useMemo(() => {
    type FlatRow = {
      key: string;
      clientLabel: string;
      currencyCode: string;
      balance: number;
      usd: number;
    };
    const digital: FlatRow[] = [];
    const efectivo: FlatRow[] = [];
    for (const acc of cashPos) {
      for (const b of acc.balances || []) {
        const fmt = String(b.format).toUpperCase();
        const bal = parseAmt(b.balance);
        const row: FlatRow = {
          key: `${acc.account_id}-${b.currency_id}-${b.format}`,
          clientLabel: acc.account_name,
          currencyCode: b.currency_code,
          balance: bal,
          usd: amountToUsd(b.currency_code, bal, arsPerUsd),
        };
        if (fmt === 'DIGITAL') digital.push(row);
        else if (fmt === 'CASH') efectivo.push(row);
      }
    }
    return { cashDigitalRows: digital, cashEfectivoRows: efectivo };
  }, [cashPos, arsPerUsd]);

  function subtotalUsd(
    rows: Array<{ currencyCode: string; balance: number; usd: number }>,
  ) {
    return rows.reduce((a, r) => a.plus(new Big(String(r.usd))), new Big(0)).toNumber();
  }

  const physicalByCurrency = useMemo(() => {
    const m = new Map<string, { code: string; amount: number; usd: number }>();
    for (const t of physicalTotals) {
      const code = t.currency_code || '?';
      const amt = parseAmt(t.balance);
      const prev = m.get(code) || { code, amount: 0, usd: 0 };
      const nextAmt = new Big(String(prev.amount)).plus(new Big(String(amt)));
      const nextUsd = new Big(String(prev.usd)).plus(
        new Big(String(amountToUsd(code, amt, arsPerUsd))),
      );
      m.set(code, { code, amount: nextAmt.toNumber(), usd: nextUsd.toNumber() });
    }
    return Array.from(m.values());
  }, [physicalTotals, arsPerUsd]);

  const physicalGrandUsd = physicalByCurrency
    .reduce((a, x) => a.plus(new Big(String(x.usd))), new Big(0))
    .toNumber();

  const pendRetiroFlatRows = useMemo(
    () =>
      pendRetiroRows.map((p) => ({
        id: p.id,
        clientLabel: p.client_name?.trim() || (p.operation_number != null ? `#${p.operation_number}` : '—'),
        currency: p.currency_code,
        amount: Math.abs(parseAmt(p.amount)),
        usd: amountToUsd(p.currency_code, Math.abs(parseAmt(p.amount)), arsPerUsd),
      })),
    [pendRetiroRows, arsPerUsd],
  );

  const pendEntregaFlatRows = useMemo(
    () =>
      pendEntregaRows.map((p) => ({
        id: p.id,
        clientLabel: p.client_name?.trim() || (p.operation_number != null ? `#${p.operation_number}` : '—'),
        currency: p.currency_code,
        amount: Math.abs(parseAmt(p.amount)),
        usd: amountToUsd(p.currency_code, Math.abs(parseAmt(p.amount)), arsPerUsd),
      })),
    [pendEntregaRows, arsPerUsd],
  );

  const reporteActivo = useMemo(() => {
    if (periodo === 'dia') return reporteDia;
    if (periodo === 'semana') return reporteSemana;
    return reporteMes;
  }, [periodo, reporteDia, reporteSemana, reporteMes]);

  function usdCell(code: string, usd: number) {
    return code.toUpperCase() === 'EUR' ? '—' : formatMoneyAR(usd);
  }

  function renderMetricTable(section: { by_currency?: Array<{ currency_code: string; amount: string }> }) {
    const rows = section?.by_currency ?? [];
    if (rows.length === 0) {
      return (
        <EmptyState
          variant="inline"
          title="Sin movimientos"
          message="No hay partidas en esta métrica para el período seleccionado."
        />
      );
    }
    return (
      <div className="table-scroll rounded border border-subtle">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
              <th className="px-3 py-2">Divisa</th>
              <th className="px-3 py-2 text-right">Importe (nativo)</th>
              <th className="px-3 py-2 text-right">En USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const code = row.currency_code || '';
              const nat = parseAmt(row.amount);
              const usd = amountToUsd(code, nat, arsPerUsd);
              return (
                <tr key={`${code}-${index}`} className="border-b border-subtle/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{code}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(nat)}</td>
                  <td className="px-3 py-2 text-right font-mono">{usdCell(code, usd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const activeRangeLabel = (() => {
    const r = periodoRange(asOfDate, periodo);
    return r.from === r.to
      ? `Período: ${formatDate(r.from)}`
      : `Período: ${formatDate(r.from)} – ${formatDate(r.to)}`;
  })();

  return (
    <div className="space-y-8 max-w-4xl">
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
        <p className="text-xs text-fg-muted max-w-3xl leading-relaxed">
          <strong className="text-fg-muted">Capital propio</strong> = Bruto caja + CC neta − Retiros pend. (USD equiv.
          con cotización manual). Las entregas pendientes se listan aparte y <strong>no restan</strong> del capital.
          EUR en USD: — hasta definir tipo cruzado.
        </p>
      </div>

      {error ? <p className="text-error text-sm">{error}</p> : null}

      {loading ? (
        <div className="space-y-8" aria-busy="true" aria-label="Cargando posición integral">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Caja — dinero real</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Obligaciones</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
          <section>
            <SkeletonCard />
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Detalle stock al corte</h2>
            <SkeletonTable rows={6} cols={4} />
          </section>
          {canReportes ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Generado en el período</h2>
              <SkeletonTable rows={5} cols={3} />
            </section>
          ) : null}
        </div>
      ) : (
        <>
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Caja — dinero real</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">Físico (arqueo sistema)</h4>
            <p className="text-lg font-semibold text-fg">{formatMoneyAR(physicalUsd)}</p>
            <p className="text-xs text-fg-muted mt-0.5">Equiv. USD</p>
          </div>
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">Digital</h4>
            <p className="text-lg font-semibold text-fg">{formatMoneyAR(digitalUsd)}</p>
            <p className="text-xs text-fg-muted mt-0.5">Equiv. USD</p>
          </div>
          <div className="card-surface border-2 border-brand/20">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">Total bruto</h4>
            <p className="text-lg font-bold text-fg">{formatMoneyAR(totalBrutoUsd)}</p>
            <p className="text-xs text-fg-muted mt-0.5">Equiv. USD</p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Obligaciones</h3>
        <p className="text-xs text-fg-muted -mt-1">
          CC: saldo comercial con clientes (no es caja propia). Positivo = nos deben; negativo = les debemos.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">CC neta (USD)</h4>
            <p className={`text-lg font-semibold ${deudaCcNetaUsd >= 0 ? 'text-success' : 'text-error'}`}>
              {formatMoneyAR(deudaCcNetaUsd)}
            </p>
          </div>
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">Retiros pendientes (USD)</h4>
            <p className="text-lg font-semibold text-fg">{formatMoneyAR(retirosPendUsd)}</p>
          </div>
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1">Entregas pendientes (USD)</h4>
            <p className="text-lg font-semibold text-fg">{formatMoneyAR(entregasPendUsd)}</p>
            <p className="text-[11px] text-fg-muted mt-1">No resta del capital</p>
          </div>
          <div className="card-surface">
            <h4 className="text-sm font-semibold text-fg-muted mb-1 flex items-center gap-1.5 min-w-0">
              <span className="min-w-0">Gastos del día (movimientos)</span>
              <button
                type="button"
                className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-subtle text-fg-muted hover:bg-surface hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                title={GASTOS_DIA_MOVIMIENTOS_TOOLTIP}
                aria-label={`Información sobre gastos del día: ${GASTOS_DIA_MOVIMIENTOS_TOOLTIP}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </button>
            </h4>
            <p className="text-lg font-semibold text-fg">{formatMoneyAR(gastosPeriodoUsd)}</p>
            <p className="text-[11px] text-fg-muted mt-1">
              Solo movimientos GASTO en CONFIRMADA al corte. Pasá el cursor o foco sobre el (i) para comparar con «Gastos»
              del reporte.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="card-surface border-2 border-brand/30">
          <h3 className="text-sm font-semibold text-fg-muted mb-1">Capital propio (USD)</h3>
          <p className="text-2xl font-bold text-fg">{formatMoneyAR(capitalPropioUsd)}</p>
          <p className="text-xs text-fg-muted mt-1">
            = Bruto {formatMoneyAR(totalBrutoUsd)} + CC {formatMoneyAR(deudaCcNetaUsd)} − Retiros{' '}
            {formatMoneyAR(retirosPendUsd)}
          </p>
          <span className={`mt-2 inline-block ${capitalPropioUsd >= 0 ? 'badge-success' : 'badge-error'}`}>
            {capitalPropioUsd >= 0 ? 'Positivo' : 'Negativo'}
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Detalle stock al corte</h2>

        <Disclosure
          id="efectivo"
          title="Efectivo en caja"
          subtitle="Filas CASH por cuenta — arqueo de libro"
          totalLabel="Por divisa"
          totalValue={currencySummary(cashEfectivoRows)}
        >
          {cashEfectivoRows.length === 0 ? (
            <EmptyState variant="inline" message="Sin saldos efectivo para mostrar." />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Cuenta</th>
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {cashEfectivoRows.map((r) => (
                    <tr key={r.key} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                      <td className="px-3 py-2 font-medium">{r.currencyCode}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.balance)}</td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.currencyCode, r.usd)}</td>
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
        </Disclosure>

        <Disclosure
          id="digital"
          title="Digital"
          subtitle="Filas DIGITAL por cuenta"
          totalLabel="Por divisa"
          totalValue={currencySummary(cashDigitalRows)}
        >
          {cashDigitalRows.length === 0 ? (
            <EmptyState variant="inline" message="Sin saldos digitales para mostrar." />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Cuenta</th>
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {cashDigitalRows.map((r) => (
                    <tr key={r.key} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                      <td className="px-3 py-2 font-medium">{r.currencyCode}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.balance)}</td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.currencyCode, r.usd)}</td>
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
        </Disclosure>

        <Disclosure
          id="arqueo"
          title="Arqueo físico (sistema CASH consolidado)"
          subtitle={`Suma system-totals por cuenta al ${formatDate(asOfDate)}; solo filas CASH`}
          totalLabel="Por divisa"
          totalValue={currencySummary(physicalByCurrency.map((r) => ({ currencyCode: r.code, balance: r.amount })))}
        >
          {!loading && physicalByCurrency.length === 0 ? (
            <EmptyState variant="inline" message="Sin totales físicos al corte para mostrar." />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Total (nativo)</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {physicalByCurrency.map((r) => (
                    <tr key={r.code} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 font-medium">{r.code}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.code, r.usd)}</td>
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
        </Disclosure>

        <Disclosure
          id="pend-retiro"
          title="Pendientes — Retiro"
          subtitle="Obligaciones que en Pendientes se muestran como «Retiro» (restan del capital)"
          totalLabel="En USD"
          totalValue={formatMoneyAR(retirosPendUsd)}
        >
          {pendRetiroFlatRows.length === 0 ? (
            <EmptyState variant="inline" message="No hay pendientes de retiro abiertos." title="Sin pendientes" />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Cliente / ref.</th>
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Importe</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {pendRetiroFlatRows.map((r) => (
                    <tr key={r.id} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                      <td className="px-3 py-2 font-medium">{r.currency}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.currency, r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t border-subtle bg-surface">
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(retirosPendUsd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Disclosure>

        <Disclosure
          id="pend-entrega"
          title="Pendientes — Entrega"
          subtitle="Compromisos de entrega de divisa (referencia — no resta del capital)"
          totalLabel="En USD"
          totalValue={formatMoneyAR(entregasPendUsd)}
        >
          {pendEntregaFlatRows.length === 0 ? (
            <EmptyState variant="inline" message="No hay pendientes de entrega abiertos." title="Sin pendientes" />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Cliente / ref.</th>
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Importe</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {pendEntregaFlatRows.map((r) => (
                    <tr key={r.id} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                      <td className="px-3 py-2 font-medium">{r.currency}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(r.amount)}</td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.currency, r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t border-subtle bg-surface">
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(entregasPendUsd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Disclosure>

        <Disclosure
          id="cc"
          title="Cuentas corrientes (saldo comercial)"
          subtitle="Positivo = clientes nos deben; negativo = les debemos. No es dinero en caja."
          totalLabel="Neto en USD"
          totalValue={formatMoneyAR(deudaCcNetaUsd)}
          defaultOpen
        >
          {!loading && ccFlatRows.length === 0 ? (
            <EmptyState variant="inline" message="Sin posiciones CC para mostrar." />
          ) : (
            <div className="table-scroll rounded border border-subtle">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-fg-muted border-b border-subtle bg-surface">
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Divisa</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-right">En USD</th>
                  </tr>
                </thead>
                <tbody>
                  {ccFlatRows.map((r) => (
                    <tr key={r.key} className="border-b border-subtle/60 last:border-0">
                      <td className="px-3 py-2 text-fg">{r.clientLabel}</td>
                      <td className="px-3 py-2 font-medium">{r.currencyCode}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono ${
                          r.balance >= 0 ? 'text-success' : 'text-error'
                        }`}
                      >
                        {formatMoneyAR(r.balance)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{usdCell(r.currencyCode, r.usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold border-t border-subtle bg-surface">
                    <td className="px-3 py-2" colSpan={3}>
                      Total
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(ccTotalUsd)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Disclosure>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Generado en el período</h2>

        {!canReportes ? (
          <p className="text-sm text-fg-muted border border-subtle rounded-md px-3 py-4 text-center">
            No tenés permiso para ver reportes.
            <br />
            Pedile acceso a un administrador.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(['dia', 'semana', 'mes'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriodo(p)}
                  className={`px-3 py-1.5 text-sm rounded-md border transition ${
                    periodo === p
                      ? 'bg-brand text-white border-brand'
                      : 'border-subtle text-fg-muted hover:bg-surface'
                  }`}
                >
                  {p === 'dia' ? 'Día' : p === 'semana' ? 'Semana' : 'Mes'}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-muted">{activeRangeLabel}</p>

            {!reporteActivo ? (
              <EmptyState
                message="No hay datos de reportes para el período y cotización actuales."
                title="Sin datos de reportes"
              />
            ) : (
              <>
                {REPORT_METRIC_ORDER.map((key) => {
                  const section = reporteActivo[key];
                  const totalUsd = sumMetricUsd(section, arsPerUsd);
                  const isGastos = key === 'gastos';
                  const isResultado = key === 'resultado';
                  return (
                    <Disclosure
                      key={key}
                      id={`reporte-${key}`}
                      title={REPORT_METRIC_LABELS[key]}
                      subtitle="Por divisa; total en USD según cotización manual (ARS/USD)."
                      totalLabel="Total (equiv. USD)"
                      totalValue={formatMoneyAR(totalUsd)}
                      defaultOpen={isResultado}
                      totalValueClassName={
                        isGastos ? 'text-error' : isResultado ? (totalUsd >= 0 ? 'text-success' : 'text-error') : 'text-fg'
                      }
                    >
                      {renderMetricTable(section)}
                    </Disclosure>
                  );
                })}
              </>
            )}
          </>
        )}
      </section>
        </>
      )}
    </div>
  );
}
