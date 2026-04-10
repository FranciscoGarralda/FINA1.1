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

/** Saldos reales por cuenta, divisa y formato (movement_lines). GET /api/cash-position */
export default function PosicionCajaPage() {
  const [positions, setPositions] = useState<AccountPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [asOf, setAsOf] = useState('');
  const [appliedAsOf, setAppliedAsOf] = useState('');

  async function fetchPositions(dateFilter?: string) {
    setLoading(true);
    setError('');
    try {
      let url = '/cash-position';
      if (dateFilter) url += `?as_of=${encodeURIComponent(dateFilter)}`;
      const data = await api.get<AccountPosition[]>(url);
      setPositions(data || []);
      setAppliedAsOf(dateFilter || '');
    } catch {
      setError('Error al cargar posición de caja.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPositions();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-fg mb-1">Posición de caja</h2>
        <p className="text-sm text-fg-muted">
          Saldos reales por cuenta, divisa y formato (<code className="text-xs bg-surface px-1 rounded">movement_lines</code>). Distinto del{' '}
          <span className="font-medium">Estado CC</span> (cuenta corriente comercial).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-0.5">Ver al día</label>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="border border-subtle rounded px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void fetchPositions(asOf || undefined)}
          className="px-3 py-1.5 bg-brand text-white text-sm rounded hover:bg-brand-hover"
        >
          Filtrar
        </button>
        {appliedAsOf && (
          <button
            type="button"
            onClick={() => {
              setAsOf('');
              void fetchPositions();
            }}
            className="px-3 py-1.5 text-sm text-fg-muted border border-subtle rounded hover:bg-surface"
          >
            Ver todo
          </button>
        )}
      </div>

      {error && <p className="text-error text-sm">{error}</p>}
      {loading && <p className="text-fg-muted text-sm">Cargando…</p>}
      {!loading && positions.length === 0 && !error && (
        <p className="text-fg-subtle text-sm">Sin movimientos registrados.</p>
      )}
      {!loading && positions.length > 0 && (
        <div className="space-y-4">
          {positions.map((acc) => (
            <div key={acc.account_id} className="border border-subtle rounded-lg overflow-hidden bg-elevated">
              <div className="bg-surface px-4 py-2 border-b border-subtle">
                <h3 className="text-sm font-semibold text-fg">{acc.account_name}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[280px] text-sm">
                  <thead>
                    <tr className="text-left text-fg-muted border-b bg-surface/50">
                      <th className="px-4 py-1.5">Divisa</th>
                      <th className="px-4 py-1.5">Formato</th>
                      <th className="px-4 py-1.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acc.balances.map((b, i) => {
                      const num = parseFloat(b.balance);
                      const colorClass = num > 0 ? 'text-success' : num < 0 ? 'text-error' : 'text-fg-subtle';
                      return (
                        <tr key={`${b.currency_id}-${b.format}-${i}`} className="border-b last:border-0 hover:bg-surface">
                          <td className="px-4 py-2 font-medium text-fg">{b.currency_code}</td>
                          <td className="px-4 py-2">
                            <span className="text-xs bg-surface text-fg-muted px-1.5 py-0.5 rounded">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
