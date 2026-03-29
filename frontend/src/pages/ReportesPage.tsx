import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import type { CurrencyAmount, ReportData } from '../types/reportes';
import { formatMoneyAR } from '../utils/money';

type TabMode = 'diario' | 'mensual' | 'anual';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function ReportesPage() {
  const [tab, setTab] = useState<TabMode>('diario');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    switch (tab) {
      case 'diario': setFrom(todayStr()); setTo(todayStr()); break;
      case 'mensual': setFrom(monthStart()); setTo(todayStr()); break;
      case 'anual': setFrom(yearStart()); setTo(todayStr()); break;
    }
  }, [tab]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const url = `/reportes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const d = await api.get<ReportData>(url);
      setData(d);
    } catch {
      setError('Error al cargar reporte.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void fetchReport(); }, [fetchReport]);

  const TABS: { key: TabMode; label: string }[] = [
    { key: 'diario', label: 'Diario' },
    { key: 'mensual', label: 'Mensual' },
    { key: 'anual', label: 'Anual' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-2">Reportes</h2>
      <p className="text-sm text-gray-600 mb-4">
        Métricas por divisa (real): utilidad FX, comisiones, gastos y resultado. Sin conversión a una divisa base ni cotizaciones auxiliares.
      </p>

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex flex-wrap gap-x-4 gap-y-1 sm:gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] sm:min-h-0 pb-3 text-sm font-medium border-b-2 transition-colors ${
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

      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div className="min-w-0">
          <label className="block text-xs text-gray-500 mb-0.5">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full max-w-[11rem] border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <div className="min-w-0">
          <label className="block text-xs text-gray-500 mb-0.5">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full max-w-[11rem] border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void fetchReport()}
          className="w-full sm:w-auto rounded-md border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] sm:min-h-0"
        >
          Actualizar
        </button>
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
              <div key={item.currency_id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${c.badge}`}>{item.currency_code}</span>
                <span className={`font-mono text-sm font-medium min-w-0 text-right break-all ${isNeg ? 'text-red-600' : ''}`}>
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
