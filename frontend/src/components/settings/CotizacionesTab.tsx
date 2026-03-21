import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import MoneyInput from '../common/MoneyInput';

interface Currency { id: string; code: string; name: string; active: boolean; }
interface FXQuote {
  id: string;
  from_currency_id: string;
  from_currency_code: string;
  to_currency_id: string;
  to_currency_code: string;
  rate: string;
  active: boolean;
  updated_at: string;
}

export default function CotizacionesTab() {
  const { isSuperAdmin } = useAuth();
  const [quotes, setQuotes] = useState<FXQuote[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newRate, setNewRate] = useState('');
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [q, c] = await Promise.all([
        api.get<FXQuote[]>('/manual-fx-quotes'),
        api.get<Currency[]>('/currencies'),
      ]);
      setQuotes(q || []);
      setCurrencies((c || []).filter((x) => x.active));
    } catch {
      setError('Error al cargar cotizaciones.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newFrom || !newTo || !newRate) { setError('Completá todos los campos.'); return; }
    if (newFrom === newTo) { setError('Las divisas deben ser distintas.'); return; }
    setCreating(true); setError('');
    try {
      await api.post('/manual-fx-quotes', { from_currency_id: newFrom, to_currency_id: newTo, rate: newRate });
      setShowCreate(false); setNewFrom(''); setNewTo(''); setNewRate('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Error al crear cotización.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSave(id: string) {
    setSaving(true); setError('');
    try {
      await api.put(`/manual-fx-quotes/${id}`, { rate: editRate, active: editActive });
      setEditId(null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Error al guardar cotización.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(q: FXQuote) {
    setEditId(q.id);
    setEditRate(q.rate);
    setEditActive(q.active);
  }

  if (loading) return <p className="text-sm text-gray-500">Cargando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Cotizaciones manuales</h3>
        {isSuperAdmin && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            {showCreate ? 'Cancelar' : '+ Nueva'}
          </button>
        )}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {showCreate && (
        <div className="bg-gray-50 p-4 rounded border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Divisa origen</label>
              <select value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Divisa destino</label>
              <select value={newTo} onChange={(e) => setNewTo(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">—</option>
                {currencies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <MoneyInput label="Cotización" value={newRate} onValueChange={setNewRate} fractionDigits={8} />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 transition"
          >
            {creating ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Origen</th>
              <th className="py-2 pr-3">Destino</th>
              <th className="py-2 pr-3">Cotización</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3">Última act.</th>
              {isSuperAdmin && <th className="py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-gray-400">Sin cotizaciones cargadas.</td></tr>
            )}
            {quotes.map((q) => (
              <tr key={q.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-3 font-medium">{q.from_currency_code}</td>
                <td className="py-2 pr-3 font-medium">{q.to_currency_code}</td>
                <td className="py-2 pr-3 font-mono">
                  {editId === q.id ? (
                    <MoneyInput value={editRate} onValueChange={setEditRate} fractionDigits={8} />
                  ) : q.rate}
                </td>
                <td className="py-2 pr-3">
                  {editId === q.id ? (
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                      {editActive ? 'Activa' : 'Inactiva'}
                    </label>
                  ) : (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${q.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {q.active ? 'Activa' : 'Inactiva'}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-400 text-xs">{new Date(q.updated_at).toLocaleDateString('es-AR')}</td>
                {isSuperAdmin && (
                  <td className="py-2 text-right">
                    {editId === q.id ? (
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => handleSave(q.id)} disabled={saving} className="text-xs text-green-600 hover:underline disabled:opacity-50">Guardar</button>
                        <button onClick={() => setEditId(null)} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(q)} className="text-xs text-blue-600 hover:underline">Editar</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
