import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CurrencyAmount, DailySummary, ReportData, ReportMetricKey } from '../types/reportes';
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

/** Títulos fijos en tarjetas (no usar solo definitions como título). */
const CARD_TITLES: Record<ReportMetricKey, string> = {
  utilidad: 'Utilidad compra-venta',
  profit: 'Comisiones / profit',
  gastos: 'Gastos',
  resultado: 'Resultado neto',
};

const CARD_STYLE: Record<ReportMetricKey, { border: string; bg: string; title: string; accent: string }> = {
  utilidad: {
    border: 'border-blue-200',
    bg: 'bg-blue-50/80',
    title: 'text-blue-900',
    accent: 'text-blue-700',
  },
  profit: {
    border: 'border-purple-200',
    bg: 'bg-purple-50/80',
    title: 'text-purple-900',
    accent: 'text-purple-700',
  },
  gastos: {
    border: 'border-red-200',
    bg: 'bg-red-50/80',
    title: 'text-red-900',
    accent: 'text-red-700',
  },
  resultado: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50/80',
    title: 'text-emerald-900',
    accent: 'text-emerald-700',
  },
};

export default function InicioPage() {
  const { can } = useAuth();
  const canReportes = can('reportes.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);

  const [refDate, setRefDate] = useState(todayStr);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [sumLoading, setSumLoading] = useState(true);
  const [sumError, setSumError] = useState('');

  const [detailKey, setDetailKey] = useState<ReportMetricKey | null>(null);
  const [detailFrom, setDetailFrom] = useState(todayStr);
  const [detailTo, setDetailTo] = useState(todayStr);
  const [rangeData, setRangeData] = useState<ReportData | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeError, setRangeError] = useState('');

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

  const loadRangeReport = async (from: string, to: string) => {
    setRangeLoading(true);
    setRangeError('');
    try {
      const d = await api.get<ReportData>(
        `/reportes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      setRangeData(d);
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 403) {
        setRangeError('No tenés permiso para ver reportes por rango.');
      } else {
        setRangeError('No se pudo cargar el reporte para el período.');
      }
      setRangeData(null);
    } finally {
      setRangeLoading(false);
    }
  };

  const openDetail = (key: ReportMetricKey) => {
    setDetailKey(key);
    setDetailFrom(refDate);
    setDetailTo(refDate);
    setRangeData(null);
    setRangeError('');
    if (canReportes) {
      void loadRangeReport(refDate, refDate);
    }
  };

  const closeDetail = useCallback(() => {
    setDetailKey(null);
    setRangeData(null);
    setRangeError('');
  }, []);

  useEffect(() => {
    if (!detailKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailKey, closeDetail]);

  function renderMetricCard(key: ReportMetricKey) {
    if (!summary) return null;
    const refSec = summary.reference[key].by_currency ?? [];
    const cmpSec = summary.compare[key].by_currency ?? [];
    const rows = mergedRows(refSec, cmpSec);
    const st = CARD_STYLE[key];

    return (
      <button
        key={key}
        type="button"
        onClick={() => openDetail(key)}
        className={`text-left rounded-xl border-2 ${st.border} ${st.bg} p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 flex flex-col min-h-[140px]`}
      >
        <h3 className={`text-sm font-semibold ${st.title} mb-1`}>{CARD_TITLES[key]}</h3>
        <p className="text-[11px] text-gray-600 mb-2 leading-snug">
          Por divisa ({summary.reference_date} vs {summary.compare_date}). No se suman montos entre monedas.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 flex-1">Sin movimientos en esta métrica para este día.</p>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-44 -mx-1 flex-1 rounded border border-white/60 bg-white/50">
            <table className="w-full min-w-[260px] text-[11px] sm:text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200/80">
                  <th className="px-2 py-1 font-medium">Div.</th>
                  <th className="px-2 py-1 text-right font-medium">Día</th>
                  <th className="px-2 py-1 text-right font-medium">Ayer</th>
                  <th className="px-2 py-1 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100/80 last:border-0">
                    <td className={`px-2 py-1 font-semibold ${st.accent}`}>{r.code}</td>
                    <td className="px-2 py-1 text-right font-mono text-gray-900">{formatMoneyAR(String(r.refN))}</td>
                    <td className="px-2 py-1 text-right font-mono text-gray-600">{formatMoneyAR(String(r.cmpN))}</td>
                    <td className={`px-2 py-1 text-right font-mono font-medium ${deltaClass(r.delta)}`}>
                      {r.delta > 0 ? '+' : ''}
                      {formatMoneyAR(String(r.delta))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2 shrink-0">
          {canReportes
            ? 'Tocá para ampliar o elegir otro rango de fechas.'
            : 'Tocá para ampliar.'}
        </p>
      </button>
    );
  }

  function renderDetailModal() {
    if (!detailKey || !summary) return null;
    const refSec = summary.reference[detailKey].by_currency ?? [];
    const cmpSec = summary.compare[detailKey].by_currency ?? [];
    const rows = mergedRows(refSec, cmpSec);
    const def = summary.definitions[detailKey] ?? '';
    const rangeSection = rangeData ? rangeData[detailKey].by_currency : [];

    return (
      <div
        className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inicio-detail-title"
        onClick={closeDetail}
      >
        <div
          className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-3">
            <div>
              <h3 id="inicio-detail-title" className="text-lg font-semibold text-gray-900">
                {CARD_TITLES[detailKey]}
              </h3>
              {def ? (
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{def}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeDetail}
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cerrar
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3 space-y-6">
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Día {summary.reference_date} vs {summary.compare_date}
              </h4>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                {rows.length === 0 ? (
                  <p className="text-sm text-gray-400 px-4 py-6 text-center">Sin datos para este día.</p>
                ) : (
                  <table className="w-full min-w-[320px] text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 border-b bg-gray-50">
                        <th className="px-3 py-2">Divisa</th>
                        <th className="px-3 py-2 text-right">Día</th>
                        <th className="px-3 py-2 text-right">Ayer</th>
                        <th className="px-3 py-2 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-gray-800">{r.code}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(String(r.refN))}</td>
                          <td className="px-3 py-2 text-right font-mono text-gray-600">
                            {formatMoneyAR(String(r.cmpN))}
                          </td>
                          <td className={`px-3 py-2 text-right font-mono font-medium ${deltaClass(r.delta)}`}>
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

            {canReportes ? (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Período personalizado
                </h4>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Desde</label>
                    <input
                      type="date"
                      value={detailFrom}
                      onChange={(e) => setDetailFrom(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Hasta</label>
                    <input
                      type="date"
                      value={detailTo}
                      onChange={(e) => setDetailTo(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRangeReport(detailFrom, detailTo)}
                    className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900 min-h-[44px] sm:min-h-0"
                  >
                    Actualizar período
                  </button>
                </div>
                {rangeLoading && <p className="text-sm text-gray-500">Cargando período…</p>}
                {rangeError && <p className="text-sm text-red-600">{rangeError}</p>}
                {!rangeLoading && rangeData && (
                  <div className="rounded-lg border border-gray-200 divide-y">
                    {rangeSection.length === 0 ? (
                      <p className="text-sm text-gray-400 px-4 py-4">Sin datos en el período.</p>
                    ) : (
                      rangeSection.map((item) => {
                        const num = parseFloat(item.amount);
                        const isNeg = num < 0;
                        return (
                          <div
                            key={item.currency_id}
                            className="flex flex-wrap justify-between gap-2 px-4 py-2.5"
                          >
                            <span className="text-sm font-medium text-gray-700">{item.currency_code}</span>
                            <span
                              className={`font-mono text-sm ${isNeg ? 'text-red-600' : 'text-gray-900'}`}
                            >
                              {formatMoneyAR(item.amount)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Para cargar totales por rango de fechas necesitás permiso de reportes. Pedile acceso a un administrador.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">Inicio</h2>
        <p className="text-sm text-gray-600">
          Resultados del día <strong>por divisa</strong> (misma lógica que el detalle). Tocá una tarjeta para ampliar o,
          si tenés permiso, otro rango de fechas.
        </p>
        <p className="text-xs text-gray-500 mt-1">Montos por divisa; no se suman entre monedas.</p>
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
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 min-h-[44px] sm:min-h-0"
        >
          Actualizar
        </button>
      </div>

      {sumError && <p className="text-red-600 text-sm">{sumError}</p>}
      {sumLoading && <p className="text-gray-500 text-sm">Cargando resumen…</p>}

      {!sumLoading && summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(['utilidad', 'profit', 'gastos', 'resultado'] as const).map((k) => renderMetricCard(k))}
        </div>
      )}

      {detailKey ? renderDetailModal() : null}
    </div>
  );
}
