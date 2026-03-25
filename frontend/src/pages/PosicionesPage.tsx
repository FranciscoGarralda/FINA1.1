import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { formatMoneyAR } from '../utils/money';

interface CurrencyBalance {
  currency_id: string;
  currency_code: string;
  balance: string;
}

interface ClientBalanceSummary {
  client_id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  balances: CurrencyBalance[];
}

export default function PosicionesPage() {
  const [items, setItems] = useState<ClientBalanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<ClientBalanceSummary[]>('/cc-balances')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      String(c.client_code).includes(q)
    );
  });

  function balanceColor(b: string) {
    const n = parseFloat(b);
    if (n < 0) return 'text-red-600';
    if (n > 0) return 'text-green-600';
    return 'text-gray-500';
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Estado de CC</h2>
      <p className="text-xs text-gray-500 mb-3">Saldos comerciales por cliente y divisa.</p>

      <input
        type="text"
        placeholder="Buscar por nombre o código..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm border border-gray-300 rounded px-3 py-2 text-sm"
      />

      {loading ? (
        <p className="text-gray-500 text-sm">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500 text-sm">No hay posiciones activas.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((client) => (
            <div
              key={client.client_id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-sm cursor-pointer transition"
              onClick={() => navigate(`/posiciones/${client.client_id}`)}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                <div className="min-w-0">
                  <span className="font-medium text-gray-800 break-words">
                    {client.last_name}, {client.first_name}
                  </span>
                  <span className="ml-2 text-xs text-gray-400 shrink-0">#{client.client_code}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {client.balances.map((b) => (
                  <span
                    key={b.currency_id}
                    className={`text-sm font-mono ${balanceColor(b.balance)}`}
                  >
                    {b.currency_code}: {formatMoneyAR(b.balance)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
