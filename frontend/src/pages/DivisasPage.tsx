import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import CurrencyFormModal from '../components/currencies/CurrencyFormModal';

interface Currency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export default function DivisasPage() {
  const { can } = useAuth();
  const canEdit = can('currencies.edit');
  const canCreate = can('currencies.create');
  const canToggle = can('currencies.toggle_active');

  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalCurrency, setModalCurrency] = useState<Currency | null | 'new'>(null);

  const fetchCurrencies = async () => {
    try {
      const data = await api.get<Currency[]>('/currencies');
      setCurrencies(data);
    } catch {
      setCurrencies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrencies();
  }, []);

  const toggleActive = async (c: Currency) => {
    try {
      await api.put(`/currencies/${c.id}/active`, { active: !c.active });
      setCurrencies((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
    } catch (err: any) {
      alert(err?.message || 'Error al cambiar estado');
    }
  };

  const filtered = currencies.filter(
    (c) =>
      c.code.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-fg shrink-0">Divisas</h2>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto min-w-0">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-subtle rounded-md px-3 py-2 text-sm w-full sm:w-48 min-w-0 focus:outline-none focus:border-brand shadow-focus-brand"
          />
          {canCreate && (
            <button
              onClick={() => setModalCurrency('new')}
              className="bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-hover text-sm font-medium w-full sm:w-auto shrink-0"
            >
              + Nueva divisa
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-fg-muted">Cargando...</p>
      ) : (
        <div className="bg-elevated rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="bg-surface">
              <tr className="text-left text-fg-muted">
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                {(canEdit || canToggle) && <th className="px-4 py-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-fg">{c.code}</td>
                  <td className="px-4 py-3 text-fg">{c.name}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={!canToggle}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        c.active ? 'bg-success-soft text-success' : 'bg-error-soft text-error'
                      } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {c.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalCurrency(c)}
                        className="text-info hover:text-info text-xs font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={(canEdit || canToggle) ? 4 : 3} className="px-4 py-6 text-center text-fg-subtle">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalCurrency && (
        <CurrencyFormModal
          currency={modalCurrency === 'new' ? null : modalCurrency}
          onClose={() => setModalCurrency(null)}
          onSaved={() => {
            setModalCurrency(null);
            fetchCurrencies();
          }}
        />
      )}
    </div>
  );
}
