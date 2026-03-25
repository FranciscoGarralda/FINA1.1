import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatMoneyAR } from '../utils/money';

interface CurrencyAmount {
  currency_id: string;
  currency_code: string;
  amount: string;
}

interface ReportSection {
  by_currency: CurrencyAmount[];
}

interface DashboardDayMetrics {
  utilidad: ReportSection;
  profit: ReportSection;
  gastos: ReportSection;
  resultado: ReportSection;
}

interface DailySummary {
  reference_date: string;
  compare_date: string;
  reference: DashboardDayMetrics;
  compare: DashboardDayMetrics;
  definitions: Record<string, string>;
}

interface Balance {
  currency_id: string;
  currency_code: string;
  format: string;
  balance: string;
}

interface AccountPosition {
  account_id: string;
  account_name: string;
  balances: Balance[];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function parseAmt(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function mergedRows(ref: CurrencyAmount[], cmp: CurrencyAmount[]) {
  const ids = new Set<string>();
  for (const x of ref) ids.add(x.currency_id);
  for (const x of cmp) ids.add(x.currency_id);
  return Array.from(ids).map((id) => {
    const a = ref.find((r) => r.currency_id === id);
    const b = cmp.find((r) => r.currency_id === id);
    const code = a?.currency_code || b?.currency_code || id;
    const refN = parseAmt(a?.amount);
    const cmpN = parseAmt(b?.amount);
    return { id, code, refN, cmpN, delta: refN - cmpN };
  });
}

function deltaClass(d: number) {
  if (d > 0) return 'text-green-700';
  if (d < 0) return 'text-red-600';
  return 'text-gray-500';
}

type MetricKey = 'utilidad' | 'profit' | 'gastos' | 'resultado';

const METRIC_LABELS: Record<MetricKey, string> = {
  utilidad: 'Utilidad FX',
  profit: 'Comisiones / profit',
  gastos: 'Gastos',
  resultado: 'Neto (resultado)',
};

export default function InicioPage() {
  const { can } = useAuth();
  const canReportes = can('reportes.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);
  const canCash = can('cash_position.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);

  const [refDate, setRefDate] = useState(todayStr);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [sumLoading, setSumLoading] = useState(true);
  const [sumError, setSumError] = useState('');

  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState('');
  const [asOf, setAsOf] = useState('');
  const [appliedAsOf, setAppliedAsOf] = useState('');

  const loadSummary = useCallback(async () => {
    setSumLoading(true);
    setSumError('');
    try {
      const d = await api.get<DailySummary>(`/dashboard/daily-summary?date=${refDate}`);
      setSummary(d);
    } catch {
      setSumError('Error al cargar el resumen del día.');
      setSummary(null);
    } finally {
      setSumLoading(false);
    }
  }, [refDate]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function fetchPositions(dateFilter?: string) {
    setCashLoading(true);
    setCashError('');
    try {
      let url = '/cash-position';
      if (dateFilter) url += `?as_of=${dateFilter}`;
      const data = await api.get<AccountPosition[]>(url);
      setPositions(data || []);
      setAppliedAsOf(dateFilter || '');
    } catch {
      setCashError('Error al cargar posición de caja.');
    } finally {
      setCashLoading(false);
    }
  }

  useEffect(() => {
    if (!canCash) return;
    void fetchPositions();
  }, [canCash]);

  function renderMetricBlock(key: MetricKey) {
    if (!summary) return null;
    const refSec = summary.reference[key].by_currency ?? [];
    const cmpSec = summary.compare[key].by_currency ?? [];
    const rows = mergedRows(refSec, cmpSec);
    const def = summary.definitions[key] ?? '';

    return (
      <div key={key} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-800">{METRIC_LABELS[key]}</h3>
          <p className="text-xs text-gray-500 mt-1 leading-snug">{def}</p>
        </div>
        <div className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-gray-400 px-4 py-3">Sin movimientos este día.</p>
          ) : (
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b bg-white">
                  <th className="px-4 py-2">Divisa</th>
                  <th className="px-4 py-2 text-right">Día ({summary.reference_date})</th>
                  <th className="px-4 py-2 text-right">Ayer ({summary.compare_date})</th>
                  <th className="px-4 py-2 text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${key}-${r.id}`} className="border-b last:border-0 hover:bg-gray-50/80">
                    <td className="px-4 py-2 font-medium text-gray-800">{r.code}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatMoneyAR(String(r.refN))}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-600">{formatMoneyAR(String(r.cmpN))}</td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${deltaClass(r.delta)}`}>
                      {r.delta > 0 ? '+' : ''}
                      {formatMoneyAR(String(r.delta))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">Inicio</h2>
        <p className="text-sm text-gray-600 mb-1">
          Resumen del día: utilidad FX, comisiones (profit), gastos y neto. Mismas definiciones que el módulo Reportes
          (un día = <code className="text-xs bg-gray-100 px-1 rounded">from</code> ={' '}
          <code className="text-xs bg-gray-100 px-1 rounded">to</code>).
        </p>
        {canReportes && (
          <p className="text-xs text-gray-500">
            <Link to="/reportes" className="text-blue-600 hover:text-blue-800">
              Ir a Reportes
            </Link>{' '}
            para rangos, estimado en divisa base y cotizaciones manuales.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-0.5">Día de referencia</label>
          <input
            type="date"
            value={refDate}
            onChange={(e) => setRefDate(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Actualizar
        </button>
      </div>

      {sumError && <p className="text-red-600 text-sm">{sumError}</p>}
      {sumLoading && <p className="text-gray-500 text-sm">Cargando resumen…</p>}

      {!sumLoading && summary && (
        <div className="grid gap-4 md:grid-cols-2">
          {(['utilidad', 'profit', 'gastos', 'resultado'] as const).map((k) => renderMetricBlock(k))}
        </div>
      )}

      {canCash && (
        <details className="border border-gray-200 rounded-lg bg-white group">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-800 bg-gray-50 rounded-lg group-open:rounded-b-none border-b border-transparent group-open:border-gray-200">
            Posición de caja (detalle por cuenta)
          </summary>
          <div className="p-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-3">
              Saldos reales por cuenta, divisa y formato (movement_lines). No reemplaza el detalle de reportes arriba.
            </p>
            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Ver al día</label>
                <input
                  type="date"
                  value={asOf}
                  onChange={(e) => setAsOf(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void fetchPositions(asOf || undefined)}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >
                Filtrar
              </button>
              {appliedAsOf && (
                <button
                  type="button"
                  onClick={() => {
                    setAsOf('');
                    void fetchPositions();
                  }}
                  className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Ver todo
                </button>
              )}
            </div>
            {cashError && <p className="text-red-600 text-sm mb-2">{cashError}</p>}
            {cashLoading && <p className="text-gray-500 text-sm">Cargando caja…</p>}
            {!cashLoading && positions.length === 0 && !cashError && (
              <p className="text-gray-400 text-sm">Sin movimientos registrados.</p>
            )}
            {!cashLoading && positions.length > 0 && (
              <div className="space-y-4">
                {positions.map((acc) => (
                  <div key={acc.account_id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700">{acc.account_name}</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[280px] text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b bg-gray-50/50">
                            <th className="px-4 py-1.5">Divisa</th>
                            <th className="px-4 py-1.5">Formato</th>
                            <th className="px-4 py-1.5 text-right">Saldo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {acc.balances.map((b, i) => {
                            const num = parseFloat(b.balance);
                            const colorClass = num > 0 ? 'text-green-700' : num < 0 ? 'text-red-600' : 'text-gray-400';
                            return (
                              <tr key={`${b.currency_id}-${b.format}-${i}`} className="border-b last:border-0 hover:bg-gray-50">
                                <td className="px-4 py-2 font-medium text-gray-800">{b.currency_code}</td>
                                <td className="px-4 py-2">
                                  <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                    {b.format === 'CASH' ? 'Efectivo' : 'Digital'}
                                  </span>
                                </td>
                                <td className={`px-4 py-2 text-right font-mono font-medium ${colorClass}`}>
                                  {formatMoneyAR(b.balance)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
