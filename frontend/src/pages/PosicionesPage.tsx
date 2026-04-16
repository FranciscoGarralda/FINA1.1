import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import ApiErrorBanner from '../components/common/ApiErrorBanner';
import { SkeletonCard } from '../components/common/Skeleton';
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
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoadError('');
    api
      .get<ClientBalanceSummary[]>('/cc-balances')
      .then((data) => {
        setItems(data);
      })
      .catch(() => {
        setLoadError('No se pudieron cargar las posiciones CC. Revisá la conexión e intentá de nuevo.');
      })
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
    if (n < 0) return 'text-error';
    if (n > 0) return 'text-success';
    return 'text-fg-muted';
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-fg mb-1">Estado de CC</h2>
      <p className="text-xs text-fg-muted mb-3">
        Clientes con CC habilitada. Solo se muestran importes por divisa cuando el saldo es distinto de cero.
      </p>

      <ApiErrorBanner message={loadError} />

      <input
        type="text"
        placeholder="Buscar por nombre o código..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm border border-subtle rounded px-3 py-2 text-sm"
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : loadError ? null : filtered.length === 0 ? (
        <p className="text-fg-muted text-sm">
          {items.length === 0
            ? 'No hay clientes activos con CC habilitada.'
            : 'Ningún cliente coincide con la búsqueda.'}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((client) => (
            <div
              key={client.client_id}
              className="bg-elevated border border-subtle rounded-lg p-4 hover:shadow-sm cursor-pointer transition"
              onClick={() => navigate(`/posiciones/${client.client_id}`)}
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2 min-w-0">
                <div className="min-w-0">
                  <span className="font-medium text-fg break-words">
                    {client.last_name}, {client.first_name}
                  </span>
                  <span className="ml-2 text-xs text-fg-subtle shrink-0">#{client.client_code}</span>
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
