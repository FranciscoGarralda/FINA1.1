import { useEffect, useState, useMemo, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatMoneyAR } from '../utils/money';
import MoneyInput from '../components/common/MoneyInput';

interface Currency { id: string; code: string; name: string; active: boolean; }
interface CurrencyAmount { currency_id: string; currency_code: string; amount: string; }
interface ReportSection { by_currency: CurrencyAmount[]; }
interface UsedQuote { from_currency_code: string; to_currency_code: string; rate: string; updated_at: string; }
interface MissingQuote { currency_code: string; reason: string; }
interface Estimated {
  base_currency_code: string;
  total: string;
  label: string;
  used_quotes: UsedQuote[];
  missing_quotes: MissingQuote[];
}
interface ReportData {
  utilidad: ReportSection;
  profit: ReportSection;
  gastos: ReportSection;
  resultado: ReportSection;
  estimated?: Estimated;
}
interface FXQuote {
  id: string;
  from_currency_id: string;
  from_currency_code: string;
  to_currency_id: string;
  to_currency_code: string;
  rate: string;
  active: boolean;
  updated_at: string;
}

type TabMode = 'diario' | 'mensual' | 'anual';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function ReportesPage() {
  const { can } = useAuth();
  const canEditQuotes = can('manual_fx_quotes.edit');

  const [tab, setTab] = useState<TabMode>('diario');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [baseCurrencyId, setBaseCurrencyId] = useState('');
  const [showEstimated, setShowEstimated] = useState(false);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Quotes editor state
  const [quotes, setQuotes] = useState<FXQuote[]>([]);
  const [dirtyRates, setDirtyRates] = useState<Record<string, { rate: string; active: boolean }>>({});
  const [savingQuotes, setSavingQuotes] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState('');
  const [quoteMsgType, setQuoteMsgType] = useState<'ok' | 'err'>('ok');
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    api.get<Currency[]>('/currencies').then((c) => setCurrencies((c || []).filter((x) => x.active)));
    loadQuotes();
  }, []);

  async function loadQuotes() {
    try {
      const q = await api.get<FXQuote[]>('/manual-fx-quotes');
      setQuotes(q || []);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    switch (tab) {
      case 'diario': setFrom(todayStr()); setTo(todayStr()); break;
      case 'mensual': setFrom(monthStart()); setTo(todayStr()); break;
      case 'anual': setFrom(yearStart()); setTo(todayStr()); break;
    }
  }, [tab]);

  const fetchReport = useCallback(async () => {
    setLoading(true); setError('');
    try {
      let url = `/reportes?from=${from}&to=${to}`;
      if (showEstimated && baseCurrencyId) url += `&base_currency_id=${baseCurrencyId}`;
      const d = await api.get<ReportData>(url);
      setData(d);
    } catch {
      setError('Error al cargar reporte.');
    } finally {
      setLoading(false);
    }
  }, [from, to, showEstimated, baseCurrencyId]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const baseCurrencyCode = useMemo(() => {
    return currencies.find((c) => c.id === baseCurrencyId)?.code || '';
  }, [baseCurrencyId, currencies]);

  // Quotes editor: currencies that need a quote (all active except base)
  const quotableCurrencies = useMemo(() => {
    if (!baseCurrencyId) return [];
    return currencies.filter((c) => c.id !== baseCurrencyId);
  }, [currencies, baseCurrencyId]);

  // Build lookup: from_currency_id -> FXQuote (where to == base)
  const quoteMap = useMemo(() => {
    const m: Record<string, FXQuote> = {};
    for (const q of quotes) {
      if (q.to_currency_id === baseCurrencyId) {
        m[q.from_currency_id] = q;
      }
    }
    return m;
  }, [quotes, baseCurrencyId]);

  function getRowState(currId: string) {
    const existing = quoteMap[currId];
    const dirty = dirtyRates[currId];
    return {
      rate: dirty?.rate ?? existing?.rate ?? '',
      active: dirty?.active ?? existing?.active ?? true,
      id: existing?.id,
      updatedAt: existing?.updated_at,
    };
  }

  function setRowRate(currId: string, rate: string) {
    setDirtyRates((prev) => ({ ...prev, [currId]: { ...getRowState(currId), rate } }));
  }

  function setRowActive(currId: string, active: boolean) {
    setDirtyRates((prev) => ({ ...prev, [currId]: { ...getRowState(currId), active } }));
  }

  async function handleSaveAndRecalc() {
    setSavingQuotes(true); setQuoteMsg('');
    try {
      for (const curr of quotableCurrencies) {
        const dirty = dirtyRates[curr.id];
        if (!dirty || !dirty.rate) continue;
        const existing = quoteMap[curr.id];
        if (existing) {
          await api.put(`/manual-fx-quotes/${existing.id}`, { rate: dirty.rate, active: dirty.active });
        } else {
          await api.post('/manual-fx-quotes', {
            from_currency_id: curr.id,
            to_currency_id: baseCurrencyId,
            rate: dirty.rate,
          });
        }
      }
      setDirtyRates({});
      await loadQuotes();
      setQuoteMsg('Cotizaciones guardadas.');
      setQuoteMsgType('ok');
      await fetchReport();
    } catch {
      setQuoteMsg('No se pudieron guardar las cotizaciones.');
      setQuoteMsgType('err');
    } finally {
      setSavingQuotes(false);
    }
  }

  const TABS: { key: TabMode; label: string }[] = [
    { key: 'diario', label: 'Diario' },
    { key: 'mensual', label: 'Mensual' },
    { key: 'anual', label: 'Anual' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Reportes</h2>

      {/* Quotes editor panel — admin only */}
      {canEditQuotes && (
        <div className="mb-6 border border-gray-200 rounded-lg bg-gray-50">
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div>
              <span className="text-sm font-semibold text-gray-700">Cotización manual (no contable)</span>
              <span className="block text-xs text-gray-400">Se usa solo para el modo ESTIMADO.</span>
            </div>
            <span className="text-gray-400 text-lg">{panelOpen ? '▲' : '▼'}</span>
          </button>

          {panelOpen && (
            <div className="px-4 pb-4 space-y-3">
              {/* Base currency selector */}
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Divisa base (estimado)</label>
                  <select
                    value={baseCurrencyId}
                    onChange={(e) => { setBaseCurrencyId(e.target.value); setDirtyRates({}); }}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    <option value="">— Seleccionar —</option>
                    {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </div>
              </div>

              {baseCurrencyId && quotableCurrencies.length > 0 && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="py-1.5 pr-3">Desde</th>
                          <th className="py-1.5 pr-3">Hacia</th>
                          <th className="py-1.5 pr-3 w-40">Cotización</th>
                          <th className="py-1.5 pr-3">Activa</th>
                          <th className="py-1.5">Actualizada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quotableCurrencies.map((curr) => {
                          const row = getRowState(curr.id);
                          return (
                            <tr key={curr.id} className="border-b">
                              <td className="py-1.5 pr-3 font-medium">{curr.code}</td>
                              <td className="py-1.5 pr-3 text-gray-500">{baseCurrencyCode}</td>
                              <td className="py-1.5 pr-3">
                                <MoneyInput
                                  value={row.rate}
                                  onValueChange={(v) => setRowRate(curr.id, v)}
                                  fractionDigits={8}
                                  placeholder="0,00"
                                />
                              </td>
                              <td className="py-1.5 pr-3">
                                <input
                                  type="checkbox"
                                  checked={row.active}
                                  onChange={(e) => setRowActive(curr.id, e.target.checked)}
                                />
                              </td>
                              <td className="py-1.5 text-xs text-gray-400">
                                {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('es-AR') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleSaveAndRecalc}
                      disabled={savingQuotes}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      {savingQuotes ? 'Guardando...' : 'Guardar y recalcular'}
                    </button>
                    <button
                      onClick={fetchReport}
                      className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition"
                    >
                      Recalcular estimado
                    </button>
                    {quoteMsg && (
                      <span className={`text-xs ${quoteMsgType === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{quoteMsg}</span>
                    )}
                  </div>
                </>
              )}

              {baseCurrencyId && quotableCurrencies.length === 0 && (
                <p className="text-xs text-gray-400">No hay otras divisas activas.</p>
              )}

              {!baseCurrencyId && (
                <p className="text-xs text-gray-400">Seleccioná una divisa base para ver/editar cotizaciones.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="flex gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Desde</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Hasta</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div className="flex items-center gap-3 ml-4">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={!showEstimated} onChange={() => setShowEstimated(false)} />
            <span className="text-gray-700">REAL (sin conversión)</span>
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="radio" checked={showEstimated} onChange={() => setShowEstimated(true)} />
            <span className="text-gray-700">ESTIMADO en {baseCurrencyCode || '...'}</span>
          </label>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {loading && <p className="text-gray-500 text-sm">Cargando reporte...</p>}

      {data && !loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ReportCard title="Utilidad (Compra/Venta)" items={data.utilidad.by_currency} color="blue" />
            <ReportCard title="Comisiones / Profit" items={data.profit.by_currency} color="purple" />
            <ReportCard title="Gastos" items={data.gastos.by_currency} color="red" />
            <ReportCard title="Resultado final" items={data.resultado.by_currency} color="green" />
          </div>

          {showEstimated && data.estimated && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-yellow-800">
                  Resultado estimado en {data.estimated.base_currency_code}
                </h3>
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">{data.estimated.label}</span>
              </div>
              <p className="text-2xl font-mono font-bold text-yellow-900">
                {baseCurrencyCode} {formatMoneyAR(data.estimated.total)}
              </p>

              {data.estimated.used_quotes && data.estimated.used_quotes.length > 0 && (
                <div>
                  <p className="text-xs text-yellow-700 font-medium mb-1">Cotizaciones usadas:</p>
                  <ul className="text-xs text-yellow-700 space-y-0.5">
                    {data.estimated.used_quotes.map((q, i) => (
                      <li key={i}>
                        {q.from_currency_code} → {q.to_currency_code}: {formatMoneyAR(q.rate, 8)}
                        <span className="text-yellow-500 ml-1">({new Date(q.updated_at).toLocaleDateString('es-AR')})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.estimated.missing_quotes && data.estimated.missing_quotes.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs text-red-700 font-medium mb-1">Faltan cotizaciones para:</p>
                  <ul className="text-xs text-red-600 space-y-0.5">
                    {data.estimated.missing_quotes.map((m, i) => (
                      <li key={i}>{m.currency_code}: {m.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {showEstimated && !baseCurrencyId && (
            <p className="text-sm text-yellow-600">Seleccioná una divisa base en el panel de cotizaciones para ver el resultado estimado.</p>
          )}
        </div>
      )}
    </div>
  );
}

const COLOR_MAP: Record<string, { border: string; bg: string; title: string; badge: string }> = {
  blue:   { border: 'border-blue-200', bg: 'bg-blue-50', title: 'text-blue-800', badge: 'bg-blue-100 text-blue-700' },
  purple: { border: 'border-purple-200', bg: 'bg-purple-50', title: 'text-purple-800', badge: 'bg-purple-100 text-purple-700' },
  red:    { border: 'border-red-200', bg: 'bg-red-50', title: 'text-red-800', badge: 'bg-red-100 text-red-700' },
  green:  { border: 'border-green-200', bg: 'bg-green-50', title: 'text-green-800', badge: 'bg-green-100 text-green-700' },
};

function ReportCard({ title, items, color }: { title: string; items: CurrencyAmount[]; color: string }) {
  const c = COLOR_MAP[color] || COLOR_MAP.blue;
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-4`}>
      <h3 className={`text-sm font-semibold ${c.title} mb-3`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">Sin datos en este período.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => {
            const num = parseFloat(item.amount);
            const isNeg = num < 0;
            return (
              <div key={item.currency_id} className="flex items-center justify-between">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${c.badge}`}>{item.currency_code}</span>
                <span className={`font-mono text-sm font-medium ${isNeg ? 'text-red-600' : ''}`}>
                  {formatMoneyAR(item.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
