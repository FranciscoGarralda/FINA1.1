import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { formatMoneyAR } from '../utils/money';

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
  const navigate = useNavigate();

  const [balances, setBalances] = useState<CurrencyBalance[]>([]);
  const [entries, setEntries] = useState<CCEntry[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    api
      .get<CurrencyBalance[]>(`/cc-balances/${clientId}`)
      .then((data) => {
        setBalances(data);
        if (data.length > 0) {
          setSelectedCurrency(data[0].currency_id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !selectedCurrency) {
      setEntries([]);
      return;
    }
    setLoadingEntries(true);
    api
      .get<CCEntry[]>(`/cc-entries?client_id=${clientId}&currency_id=${selectedCurrency}`)
      .then(setEntries)
      .catch(() => {})
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

  return (
    <div>
      <button
        onClick={() => navigate('/posiciones')}
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        &larr; Volver a posiciones
      </button>

      <h2 className="text-lg font-semibold text-gray-800 mb-4">Detalle de Posición</h2>

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : balances.length === 0 ? (
        <p className="text-gray-500 text-sm">Este cliente no tiene posiciones CC.</p>
      ) : (
        <>
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
            {loadingEntries ? (
              <p className="text-gray-500 text-sm">Cargando movimientos...</p>
            ) : entries.length === 0 ? (
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
                        <td className="px-4 py-2 text-gray-500">{e.note ?? '—'}</td>
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
