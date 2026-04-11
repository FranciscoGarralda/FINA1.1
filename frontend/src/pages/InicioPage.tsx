import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { CurrencyAmount, DailySummary, ReportData, ReportMetricKey } from '../types/reportes';
import { SkeletonCard } from '../components/common/Skeleton';
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
  if (d > 0) return 'text-success';
  if (d < 0) return 'text-error';
  return 'text-fg-muted';
}

/** Títulos fijos en tarjetas (no usar solo definitions como título). */
const CARD_TITLES: Record<ReportMetricKey, string> = {
  utilidad: 'Utilidad compra-venta',
  profit: 'Comisiones / profit',
  gastos: 'Gastos',
  resultado: 'Resultado neto',
};

const CARD_STYLE: Record<ReportMetricKey, { title: string; accent: string }> = {
  utilidad: {
    title: 'text-fg',
    accent: 'text-brand',
  },
  profit: {
    title: 'text-fg',
    accent: 'text-brand',
  },
  gastos: {
    title: 'text-fg',
    accent: 'text-error',
  },
  resultado: {
    title: 'text-fg',
    accent: 'text-success',
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
        className="card-surface card-surface-interactive text-left flex flex-col min-h-[140px] shadow-sm hover:shadow-md transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-app"
      >
        <h3 className={`text-sm font-semibold ${st.title} mb-1`}>{CARD_TITLES[key]}</h3>
        <p className="text-[11px] text-fg-muted mb-2 leading-snug">
          Por divisa ({summary.reference_date} vs {summary.compare_date}). No se suman montos entre monedas.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted flex-1">Sin movimientos en esta métrica para este día.</p>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-44 -mx-1 flex-1 rounded border border-subtle bg-surface/50">
            <table className="w-full min-w-[260px] text-[11px] sm:text-xs">
              <thead>
                <tr className="text-left text-fg-muted border-b border-subtle/80">
                  <th className="px-2 py-1 font-medium">Div.</th>
                  <th className="px-2 py-1 text-right font-medium">Día</th>
                  <th className="px-2 py-1 text-right font-medium">Ayer</th>
                  <th className="px-2 py-1 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-subtle/80 last:border-0">
                    <td className={`px-2 py-1 font-semibold ${st.accent}`}>{r.code}</td>
                    <td className="px-2 py-1 text-right font-mono text-fg">{formatMoneyAR(String(r.refN))}</td>
                    <td className="px-2 py-1 text-right font-mono text-fg-muted">{formatMoneyAR(String(r.cmpN))}</td>
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
        <p className="text-xs text-fg-muted mt-2 shrink-0">
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
          className="bg-elevated rounded-t-xl sm:rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 py-3 border-b border-subtle flex items-start justify-between gap-3">
            <div>
              <h3 id="inicio-detail-title" className="text-lg font-semibold text-fg">
                {CARD_TITLES[detailKey]}
              </h3>
              {def ? (
                <p className="text-xs text-fg-muted mt-1 leading-relaxed">{def}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeDetail}
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-surface"
            >
              Cerrar
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-3 space-y-6">
            <div>
              <h4 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">
                Día {summary.reference_date} vs {summary.compare_date}
              </h4>
              <div className="overflow-x-auto rounded-lg border border-subtle">
                {rows.length === 0 ? (
                  <p className="text-sm text-fg-subtle px-4 py-6 text-center">Sin datos para este día.</p>
                ) : (
                  <table className="w-full min-w-[320px] text-sm">
                    <thead>
                      <tr className="text-left text-fg-muted border-b bg-surface">
                        <th className="px-3 py-2">Divisa</th>
                        <th className="px-3 py-2 text-right">Día</th>
                        <th className="px-3 py-2 text-right">Ayer</th>
                        <th className="px-3 py-2 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-fg">{r.code}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatMoneyAR(String(r.refN))}</td>
                          <td className="px-3 py-2 text-right font-mono text-fg-muted">
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
                <h4 className="text-xs font-semibold text-fg-muted uppercase tracking-wide mb-2">
                  Período personalizado
                </h4>
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div>
                    <label className="block text-xs text-fg-muted mb-0.5">Desde</label>
                    <input
                      type="date"
                      value={detailFrom}
                      onChange={(e) => setDetailFrom(e.target.value)}
                      className="input-field w-auto"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-fg-muted mb-0.5">Hasta</label>
                    <input
                      type="date"
                      value={detailTo}
                      onChange={(e) => setDetailTo(e.target.value)}
                      className="input-field w-auto"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadRangeReport(detailFrom, detailTo)}
                    className="btn-primary"
                  >
                    Actualizar período
                  </button>
                </div>
                {rangeLoading && <p className="text-sm text-fg-muted">Cargando período…</p>}
                {rangeError && <p className="text-sm text-error">{rangeError}</p>}
                {!rangeLoading && rangeData && (
                  <div className="rounded-lg border border-subtle divide-y">
                    {rangeSection.length === 0 ? (
                      <p className="text-sm text-fg-subtle px-4 py-4">Sin datos en el período.</p>
                    ) : (
                      rangeSection.map((item) => {
                        const num = parseFloat(item.amount);
                        const isNeg = num < 0;
                        return (
                          <div
                            key={item.currency_id}
                            className="flex flex-wrap justify-between gap-2 px-4 py-2.5"
                          >
                            <span className="text-sm font-medium text-fg">{item.currency_code}</span>
                            <span
                              className={`font-mono text-sm ${isNeg ? 'text-error' : 'text-fg'}`}
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
              <p className="text-xs text-fg-muted">
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
        <h2 className="text-xl font-semibold text-fg mb-1">Inicio</h2>
        <p className="text-sm text-fg-muted">
          Resultados del día <strong>por divisa</strong> (misma lógica que el detalle). Tocá una tarjeta para ampliar o,
          si tenés permiso, otro rango de fechas.
        </p>
        <p className="text-xs text-fg-muted mt-1">Montos por divisa; no se suman entre monedas.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-0.5">Día de referencia</label>
          <input
            type="date"
            value={refDate}
            onChange={(e) => setRefDate(e.target.value)}
            className="input-field w-auto"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadSummary()}
          className="btn-primary"
        >
          Actualizar
        </button>
      </div>

      {sumError && <p className="text-error text-sm">{sumError}</p>}
      {sumLoading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!sumLoading && summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(['utilidad', 'profit', 'gastos', 'resultado'] as const).map((k) => renderMetricCard(k))}
        </div>
      )}

      {detailKey ? renderDetailModal() : null}
    </div>
  );
}
