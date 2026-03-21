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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Divisas</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {canCreate && (
            <button
              onClick={() => setModalCurrency('new')}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              + Nueva divisa
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                {(canEdit || canToggle) && <th className="px-4 py-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-gray-700">{c.code}</td>
                  <td className="px-4 py-3 text-gray-700">{c.name}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(c)}
                      disabled={!canToggle}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        c.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {c.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalCurrency(c)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={(canEdit || canToggle) ? 4 : 3} className="px-4 py-6 text-center text-gray-400">
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
