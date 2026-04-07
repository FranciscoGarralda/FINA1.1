import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CurrencyAmount, DailySummary, ReportMetricKey } from '../types/reportes';
import { formatMoneyAR } from '../utils/money';

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

const METRIC_LABELS: Record<ReportMetricKey, string> = {
  utilidad: 'Utilidad FX',
  profit: 'Comisiones / profit',
  gastos: 'Gastos',
  resultado: 'Neto (resultado)',
};

export default function InicioPage() {
  const { can } = useAuth();
  const canReportes = can('reportes.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);

  const [refDate, setRefDate] = useState(todayStr);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [sumLoading, setSumLoading] = useState(true);
  const [sumError, setSumError] = useState('');

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

  function renderMetricBlock(key: ReportMetricKey) {
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
            para otros rangos y el detalle por divisa.
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
    </div>
  );
}
