import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { formatMoneyAR } from '../utils/money';

interface Account {
  id: string;
  name: string;
  active: boolean;
}

interface SystemTotal {
  currency_id: string;
  currency_code: string;
  balance: string;
}

interface LineOut {
  currency_id: string;
  currency_code: string;
  system_balance_snapshot: string;
  counted_total: string;
  difference: string;
}

interface ArqueoSummary {
  id: string;
  account_id: string;
  account_name: string;
  arqueo_date: string;
  note: string | null;
  created_by_user_id: string;
  created_by_username: string;
  created_at: string;
  lines: LineOut[];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function deltaClass(d: number) {
  if (d > 0) return 'text-green-700';
  if (d < 0) return 'text-red-600';
  return 'text-gray-500';
}

export default function CashArqueosPage() {
  const { can } = useAuth();
  const canView = can('cash_arqueo.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);
  const canCreate = can('cash_arqueo.create', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [arqueoDate, setArqueoDate] = useState(todayStr);
  const [note, setNote] = useState('');
  const [totals, setTotals] = useState<SystemTotal[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [listFilterAccount, setListFilterAccount] = useState('');
  const [listFrom, setListFrom] = useState('');
  const [listTo, setListTo] = useState('');
  const [arqueos, setArqueos] = useState<ArqueoSummary[]>([]);
  const [loadingTotals, setLoadingTotals] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .get<Account[]>('/accounts')
      .then((a) => setAccounts((a || []).filter((x) => x.active)))
      .catch(() => {});
  }, []);

  const loadTotals = useCallback(async () => {
    if (!accountId) {
      setTotals([]);
      return;
    }
    setLoadingTotals(true);
    setErr('');
    try {
      const res = await api.get<{ totals: SystemTotal[] }>(
        `/cash-arqueos/system-totals?account_id=${encodeURIComponent(accountId)}&as_of=${encodeURIComponent(arqueoDate)}`
      );
      const t = res.totals || [];
      setTotals(t);
      setCounts((prev) => {
        const next = { ...prev };
        for (const row of t) {
          if (next[row.currency_id] === undefined) next[row.currency_id] = '';
        }
        return next;
      });
    } catch {
      setErr('No se pudieron cargar los saldos sistema.');
      setTotals([]);
    } finally {
      setLoadingTotals(false);
    }
  }, [accountId, arqueoDate]);

  useEffect(() => {
    if (canView) void loadTotals();
  }, [canView, loadTotals]);

  const loadList = useCallback(async () => {
    if (!canView) return;
    setLoadingList(true);
    setErr('');
    try {
      let url = '/cash-arqueos?';
      const p = new URLSearchParams();
      if (listFilterAccount) p.set('account_id', listFilterAccount);
      if (listFrom) p.set('from', listFrom);
      if (listTo) p.set('to', listTo);
      url += p.toString();
      const res = await api.get<{ arqueos: ArqueoSummary[] }>(url);
      setArqueos(res.arqueos || []);
    } catch {
      setErr('No se pudo cargar el historial.');
    } finally {
      setLoadingList(false);
    }
  }, [canView, listFilterAccount, listFrom, listTo]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || !accountId) return;
    const lines = totals
      .map((t) => ({
        currency_id: t.currency_id,
        counted_total: (counts[t.currency_id] ?? '').trim(),
      }))
      .filter((l) => l.counted_total !== '');
    if (lines.length === 0) {
      setErr('Ingresá al menos un conteo en una divisa.');
      return;
    }
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      await api.post<unknown>('/cash-arqueos', {
        account_id: accountId,
        arqueo_date: arqueoDate,
        note: note.trim() || null,
        lines,
      });
      setMsg('Arqueo registrado.');
      setNote('');
      void loadList();
    } catch (e: unknown) {
      const m = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : 'Error al guardar.';
      setErr(m);
    } finally {
      setSaving(false);
    }
  }

  if (!canView && !canCreate) {
    return <p className="text-gray-500 text-sm">No tenés permisos para arqueos de caja.</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-gray-800 mb-1">Arqueos de caja</h2>
        <p className="text-sm text-gray-600">
          v1: conteo total por cuenta y divisa (CASH + DIGITAL en el saldo sistema). Se guarda snapshot y diferencia; auditoría en el alta.
        </p>
      </div>

      {canCreate && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Nuevo arqueo</h3>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Cuenta</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  required
                >
                  <option value="">Elegir…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Fecha de corte</label>
                <input
                  type="date"
                  value={arqueoDate}
                  onChange={(e) => setArqueoDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Nota (opcional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                placeholder="Ej. cierre turno"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadTotals()}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Refrescar saldos sistema
            </button>
            {loadingTotals && <p className="text-xs text-gray-400">Cargando saldos…</p>}
            {accountId && totals.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm min-w-[280px]">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600 border-b">
                      <th className="px-3 py-2">Divisa</th>
                      <th className="px-3 py-2 text-right">Saldo sistema</th>
                      <th className="px-3 py-2 text-right">Conteo real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.map((t) => (
                      <tr key={t.currency_id} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{t.currency_code}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-700">{formatMoneyAR(t.balance)}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-28 border border-gray-300 rounded px-2 py-1 text-right font-mono text-sm"
                            placeholder="0"
                            value={counts[t.currency_id] ?? ''}
                            onChange={(e) =>
                              setCounts((c) => ({ ...c, [t.currency_id]: e.target.value }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {accountId && !loadingTotals && totals.length === 0 && (
              <p className="text-sm text-amber-700">La cuenta no tiene divisas asignadas.</p>
            )}
            <button
              type="submit"
              disabled={saving || !accountId}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Registrar arqueo'}
            </button>
            {msg && <p className="text-sm text-green-700">{msg}</p>}
            {err && <p className="text-sm text-red-600">{err}</p>}
          </form>
        </section>
      )}

      {canView && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Historial</h3>
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={listFilterAccount}
              onChange={(e) => setListFilterAccount(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
            >
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={listFrom}
              onChange={(e) => setListFrom(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder="Desde"
            />
            <input
              type="date"
              value={listTo}
              onChange={(e) => setListTo(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              placeholder="Hasta"
            />
            <button
              type="button"
              onClick={() => void loadList()}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              Aplicar filtros
            </button>
          </div>
          {loadingList && <p className="text-sm text-gray-500">Cargando…</p>}
          {!loadingList && arqueos.length === 0 && <p className="text-sm text-gray-400">Sin arqueos.</p>}
          <div className="space-y-6">
            {arqueos.map((aq) => (
              <div key={aq.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                <div className="bg-gray-50 px-4 py-2 border-b text-sm">
                  <span className="font-semibold text-gray-800">{aq.account_name}</span>
                  <span className="text-gray-500 mx-2">·</span>
                  <span className="text-gray-600">Corte {aq.arqueo_date}</span>
                  <span className="text-gray-500 mx-2">·</span>
                  <span className="text-gray-500 text-xs">{aq.created_by_username || aq.created_by_user_id}</span>
                  <span className="text-gray-400 text-xs ml-2">{new Date(aq.created_at).toLocaleString('es-AR')}</span>
                  {aq.note && <p className="text-xs text-gray-600 mt-1">Nota: {aq.note}</p>}
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[320px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="px-4 py-2">Divisa</th>
                      <th className="px-4 py-2 text-right">Sistema (snapshot)</th>
                      <th className="px-4 py-2 text-right">Conteo</th>
                      <th className="px-4 py-2 text-right">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aq.lines.map((ln) => {
                      const d = parseFloat(ln.difference);
                      return (
                        <tr key={ln.currency_id} className="border-b last:border-0">
                          <td className="px-4 py-2 font-medium">{ln.currency_code}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatMoneyAR(ln.system_balance_snapshot)}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatMoneyAR(ln.counted_total)}</td>
                          <td className={`px-4 py-2 text-right font-mono font-medium ${deltaClass(d)}`}>
                            {formatMoneyAR(ln.difference)}
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
        </section>
      )}
    </div>
  );
}
