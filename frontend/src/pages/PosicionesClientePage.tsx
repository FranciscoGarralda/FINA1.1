import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, downloadAuthenticated } from '../api/client';
import ApiErrorBanner from '../components/common/ApiErrorBanner';
import { useAuth } from '../context/AuthContext';
import { formatMoneyAR } from '../utils/money';

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface CurrencyBalance {
  currency_id: string;
  currency_code: string;
  balance: string;
}

interface CCEntry {
  id: string;
  currency_code: string;
  amount: string;
  operation_number: number | null;
  note: string | null;
  created_at: string;
}

export default function PosicionesClientePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { can } = useAuth();
  const canExportCsv = can('cc.export_csv', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);

  const [balances, setBalances] = useState<CurrencyBalance[]>([]);
  const [entries, setEntries] = useState<CCEntry[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [balancesError, setBalancesError] = useState('');
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState('');
  const [exportFrom, setExportFrom] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [exportTo, setExportTo] = useState(() => toLocalISODate(new Date()));
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    setBalancesError('');
    api
      .get<CurrencyBalance[]>(`/cc-balances/${clientId}`)
      .then((data) => {
        setBalances(data);
        if (data.length > 0) {
          setSelectedCurrency(data[0].currency_id);
        }
      })
      .catch(() => {
        setBalancesError('No se pudieron cargar los balances. Revisá la conexión e intentá de nuevo.');
        setBalances([]);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !selectedCurrency) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    setEntriesError('');
    api
      .get<CCEntry[]>(`/cc-entries?client_id=${clientId}&currency_id=${selectedCurrency}`)
      .then(setEntries)
      .catch(() => {
        setEntriesError('No se pudieron cargar los movimientos CC. Revisá la conexión e intentá de nuevo.');
        setEntries([]);
      })
      .finally(() => setLoadingEntries(false));
  }, [clientId, selectedCurrency]);

  function balanceColor(b: string) {
    const n = parseFloat(b);
    if (n < 0) return 'text-red-600';
    if (n > 0) return 'text-green-600';
    return 'text-gray-500';
  }

  function amountColor(a: string) {
    const n = parseFloat(a);
    if (n < 0) return 'text-red-600';
    if (n > 0) return 'text-green-600';
    return 'text-gray-500';
  }

  const selectedCode = balances.find((b) => b.currency_id === selectedCurrency)?.currency_code ?? '';

  async function handleExportCsv() {
    if (!clientId) return;
    setExporting(true);
    try {
      const q = new URLSearchParams({
        client_id: clientId,
        from: exportFrom,
        to: exportTo,
      });
      await downloadAuthenticated(`/cc-entries/export.csv?${q.toString()}`, 'cc_export.csv');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo exportar.';
      window.alert(msg);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Detalle de Posición</h2>

      <ApiErrorBanner message={balancesError} />

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : balancesError ? null : balances.length === 0 ? (
        <p className="text-gray-500 text-sm">Este cliente no tiene posiciones CC.</p>
      ) : (
        <>
          {canExportCsv && (
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 min-w-0">
              <div className="min-w-0 w-full sm:w-auto">
                <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
                <input
                  type="date"
                  value={exportFrom}
                  onChange={(e) => setExportFrom(e.target.value)}
                  className="w-full sm:w-auto border border-gray-300 rounded px-2 py-1 text-sm min-w-0"
                />
              </div>
              <div className="min-w-0 w-full sm:w-auto">
                <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
                <input
                  type="date"
                  value={exportTo}
                  onChange={(e) => setExportTo(e.target.value)}
                  className="w-full sm:w-auto border border-gray-300 rounded px-2 py-1 text-sm min-w-0"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleExportCsv()}
                disabled={exporting}
                className="w-full sm:w-auto rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {exporting ? 'Exportando…' : 'Exportar CSV CC'}
              </button>
            </div>
          )}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-600 mb-2">Balances</h3>
            <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Divisa</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr
                      key={b.currency_id}
                      onClick={() => setSelectedCurrency(b.currency_id)}
                      className={`border-b last:border-b-0 cursor-pointer hover:bg-gray-50 transition ${
                        b.currency_id === selectedCurrency ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-4 py-2 font-medium">{b.currency_code}</td>
                      <td className={`px-4 py-2 text-right font-mono ${balanceColor(b.balance)}`}>
                        {formatMoneyAR(b.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-600 mb-2">
              Movimientos CC — {selectedCode}
            </h3>
            <ApiErrorBanner message={entriesError} />
            {loadingEntries ? (
              <p className="text-gray-500 text-sm">Cargando movimientos...</p>
            ) : entriesError ? null : entries.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin movimientos para esta divisa.</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Fecha</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Divisa</th>
                      <th className="text-right px-4 py-2 font-medium text-gray-600">Monto</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Nº Op.</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-b-0">
                        <td className="px-4 py-2 text-gray-600">
                          {new Date(e.created_at).toLocaleString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2">{e.currency_code}</td>
                        <td className={`px-4 py-2 text-right font-mono ${amountColor(e.amount)}`}>
                          {parseFloat(e.amount) > 0 ? '+' : ''}
                          {formatMoneyAR(e.amount)}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {e.operation_number != null ? `#${e.operation_number}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-gray-500 max-w-[12rem] break-words">{e.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
