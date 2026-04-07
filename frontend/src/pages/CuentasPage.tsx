import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import AccountFormModal from '../components/accounts/AccountFormModal';
import CashOpeningBalanceModal from '../components/accounts/CashOpeningBalanceModal';

interface Account {
  id: string;
  name: string;
  active: boolean;
}

export default function CuentasPage() {
  const { can } = useAuth();
  const canEdit = can('accounts.edit');
  const canToggle = can('accounts.toggle_active');
  const canCreate = can('accounts.create');
  const canCashOpening = can('operations.saldo_inicial_caja.execute', ['SUPERADMIN', 'ADMIN', 'SUBADMIN']);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalAccount, setModalAccount] = useState<Account | null | 'new'>(null);
  const [cashOpeningOpen, setCashOpeningOpen] = useState(false);

  const fetchAccounts = async () => {
    try {
      const data = await api.get<Account[]>('/accounts');
      setAccounts(data);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const toggleActive = async (a: Account) => {
    try {
      await api.put(`/accounts/${a.id}/active`, { active: !a.active });
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)));
    } catch (err: any) {
      alert(err?.message || 'Error al cambiar estado');
    }
  };

  const filtered = accounts.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-gray-800 shrink-0">Cuentas</h2>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto min-w-0">
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full sm:w-48 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto shrink-0">
            {canCashOpening && (
              <button
                type="button"
                onClick={() => setCashOpeningOpen(true)}
                className="border border-gray-300 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium w-full sm:w-auto"
              >
                Saldo inicial caja
              </button>
            )}
            {canCreate && (
              <button
                onClick={() => setModalAccount('new')}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 text-sm font-medium w-full sm:w-auto"
              >
                + Nueva cuenta
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Cargando...</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium text-center">Estado</th>
                {(canEdit || canToggle) && <th className="px-4 py-3 font-medium text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-4 py-3 text-gray-700">{a.name}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(a)}
                      disabled={!canToggle}
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        a.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      } ${!canToggle ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                    >
                      {a.active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalAccount(a)}
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
                  <td colSpan={(canEdit || canToggle) ? 3 : 2} className="px-4 py-6 text-center text-gray-400">
                    Sin resultados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalAccount && (
        <AccountFormModal
          account={modalAccount === 'new' ? null : modalAccount}
          onClose={() => setModalAccount(null)}
          onSaved={() => {
            setModalAccount(null);
            fetchAccounts();
          }}
        />
      )}
      {cashOpeningOpen && <CashOpeningBalanceModal onClose={() => setCashOpeningOpen(false)} />}
    </div>
  );
}
