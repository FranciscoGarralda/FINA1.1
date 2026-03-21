import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatMoneyAR } from '../utils/money';

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

export default function InicioPage() {
  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asOf, setAsOf] = useState('');
  const [appliedAsOf, setAppliedAsOf] = useState('');

  useEffect(() => { fetchPositions(); }, []);

  async function fetchPositions(dateFilter?: string) {
    setLoading(true); setError('');
    try {
      let url = '/cash-position';
      if (dateFilter) url += `?as_of=${dateFilter}`;
      const data = await api.get<AccountPosition[]>(url);
      setPositions(data || []);
      setAppliedAsOf(dateFilter || '');
    } catch {
      setError('Error al cargar posición de caja.');
    } finally {
      setLoading(false);
    }
  }

  function handleFilter() {
    fetchPositions(asOf || undefined);
  }

  function handleClear() {
    setAsOf('');
    fetchPositions();
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Posición de caja</h2>
      <p className="text-xs text-gray-400 mb-4">Saldo real por cuenta, divisa y formato (solo movement_lines).</p>

      {/* Date filter */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
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
          onClick={handleFilter}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition"
        >
          Filtrar
        </button>
        {appliedAsOf && (
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition"
          >
            Ver todo
          </button>
        )}
        {appliedAsOf && (
          <span className="text-xs text-gray-400">Mostrando hasta: {appliedAsOf}</span>
        )}
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {loading && <p className="text-gray-500 text-sm">Cargando...</p>}

      {!loading && positions.length === 0 && !error && (
        <p className="text-gray-400 text-sm">Sin movimientos registrados.</p>
      )}

      {!loading && positions.length > 0 && (
        <div className="space-y-4">
          {positions.map((acc) => (
            <div key={acc.account_id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">{acc.account_name}</h3>
              </div>
              <table className="w-full text-sm">
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
                        <td className="px-4 py-2">
                          <span className="font-medium text-gray-800">{b.currency_code}</span>
                        </td>
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
          ))}
        </div>
      )}
    </div>
  );
}
