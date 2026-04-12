import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import ApiErrorBanner from '../components/common/ApiErrorBanner';
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
  format: string;
  balance: string;
}

/** Respuesta de GET /cash-position: una entrada por cuenta con balances por divisa/formato. */
interface CashPositionAccount {
  account_id: string;
  account_name: string;
  balances: Array<{
    currency_id: string;
    currency_code: string;
    format: string;
    balance: string;
  }>;
}

/** Normaliza filas del API (acepta `format` o `Format`) y strings seguros. */
function normalizeTotalsFromSystemAPI(raw: unknown[]): SystemTotal[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    const fmt = r.format ?? r.Format;
    return {
      currency_id: String(r.currency_id ?? ''),
      currency_code: String(r.currency_code ?? ''),
      format: typeof fmt === 'string' ? fmt : '',
      balance: String(r.balance ?? '0'),
    };
  });
}

interface LineOut {
  currency_id: string;
  currency_code: string;
  format: string;
  system_balance_snapshot: string;
  counted_total: string;
  difference: string;
}

function lineKey(currencyId: string, format: string) {
  return `${currencyId}|${format}`;
}

/** Clave estable por fila de totales (API viejo sin `format` usa sufijo por índice). */
function totalRowKey(t: SystemTotal, idx: number) {
  const fmt = t.format?.trim() ?? '';
  return lineKey(t.currency_id, fmt || `__row_${idx}`);
}

function formatLabel(format: string | undefined) {
  if (format == null || String(format).trim() === '') {
    return '—';
  }
  return format === 'CASH' ? 'Efectivo' : format === 'DIGITAL' ? 'Digital' : format;
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
  if (d > 0) return 'text-success';
  if (d < 0) return 'text-error';
  return 'text-fg-muted';
}

export default function CashArqueosPage() {
  const { can } = useAuth();
  const canView = can('cash_arqueo.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);
  const canCreate = can('cash_arqueo.create', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);
  /** Fallback si system-totals viene sin `format` (API viejo en :8080): mismo criterio que posición de caja. */
  const canCashPosition = can('cash_position.view', ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [arqueoDate, setArqueoDate] = useState(todayStr);
  const [note, setNote] = useState('');
  const [totals, setTotals] = useState<SystemTotal[]>([]);
  /** Conteo por `currency_id|format` */
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
  const [accountsError, setAccountsError] = useState('');

  useEffect(() => {
    api
      .get<Account[]>('/accounts')
      .then((a) => {
        setAccounts((a || []).filter((x) => x.active));
        setAccountsError('');
      })
      .catch(() => {
        setAccountsError('No se pudieron cargar las cuentas. Revisá la conexión e intentá de nuevo.');
      });
  }, []);

  const loadTotals = useCallback(async () => {
    if (!accountId) {
      setTotals([]);
      return;
    }
    setLoadingTotals(true);
    setErr('');
    try {
      const res = await api.get<{ totals: unknown[] }>(
        `/cash-arqueos/system-totals?account_id=${encodeURIComponent(accountId)}&as_of=${encodeURIComponent(arqueoDate)}`
      );
      let t = normalizeTotalsFromSystemAPI(res.totals || []);
      const allLegacyNoFormat = t.length > 0 && t.every((row) => !row.format?.trim());
      if (allLegacyNoFormat && canCashPosition) {
        try {
          const pos = await api.get<CashPositionAccount[]>(
            `/cash-position?as_of=${encodeURIComponent(arqueoDate)}`
          );
          const acc = (pos || []).find((a) => a.account_id === accountId);
          const rows = acc?.balances ?? [];
          const hasFormat = rows.some((p) => p.format && String(p.format).trim());
          if (rows.length > 0 && hasFormat) {
            t = rows.map((p) => ({
              currency_id: p.currency_id,
              currency_code: p.currency_code,
              format: p.format,
              balance: p.balance,
            }));
          }
        } catch {
          /* seguir con t legacy; puede mostrarse el banner */
        }
      }
      setTotals(t);
      setCounts((prev) => {
        const next = { ...prev };
        t.forEach((row, idx) => {
          const k = totalRowKey(row, idx);
          if (next[k] === undefined) next[k] = '';
        });
        return next;
      });
    } catch {
      setErr('No se pudieron cargar los saldos sistema.');
      setTotals([]);
    } finally {
      setLoadingTotals(false);
    }
  }, [accountId, arqueoDate, canCashPosition]);

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
    if (totals.some((t) => !(t.format && String(t.format).trim()))) {
      setErr(
        'El servidor no devuelve formato (CASH/DIGITAL) por fila. Desplegá el backend con la migración 000020 y recargá la app.'
      );
      return;
    }
    const lines = totals
      .map((t, idx) => ({
        currency_id: t.currency_id,
        format: String(t.format).trim(),
        counted_total: (counts[totalRowKey(t, idx)] ?? '').trim(),
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
    return <p className="text-fg-muted text-sm">No tenés permisos para arqueos de caja.</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-xl font-semibold text-fg mb-1">Arqueos de caja</h2>
        <p className="text-sm text-fg-muted">
          Saldo sistema y conteo por divisa y formato (efectivo / digital), alineados al ledger. Se guarda snapshot y diferencia; auditoría en el alta.
        </p>
      </div>

      <ApiErrorBanner message={accountsError} />

      {canCreate && (
        <section>
          <h3 className="text-sm font-semibold text-fg mb-3">Nuevo arqueo</h3>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-3xl">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-fg-muted mb-0.5">Cuenta</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
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
                <label className="block text-xs text-fg-muted mb-0.5">Fecha de corte</label>
                <input
                  type="date"
                  value={arqueoDate}
                  onChange={(e) => setArqueoDate(e.target.value)}
                  className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-fg-muted mb-0.5">Nota (opcional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full border border-subtle rounded px-2 py-1.5 text-sm"
                placeholder="Ej. cierre turno"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadTotals()}
              className="text-sm text-info hover:text-info"
            >
              Refrescar saldos sistema
            </button>
            {loadingTotals && <p className="text-xs text-fg-subtle">Cargando saldos…</p>}
            {accountId && totals.some((t) => !(t.format && String(t.format).trim())) && totals.length > 0 && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                El API no incluye <code className="text-xs">format</code> por fila. En producción: deploy del backend con migración{' '}
                <code className="text-xs">000020</code> y del frontend actual.
                {import.meta.env.DEV && !import.meta.env.VITE_API_BASE && (
                  <span className="block mt-2 text-xs text-amber-900">
                    En local, el proxy usa <code className="text-[11px]">127.0.0.1:8080</code>. Reiniciá el API tras actualizar el
                    repo (p. ej. <code className="text-[11px]">./scripts/run-local-dev.sh</code>) y recargá con Cmd+Shift+R.
                  </span>
                )}
                {import.meta.env.DEV && import.meta.env.VITE_API_BASE && (
                  <span className="block mt-2 text-xs text-amber-900">
                    Tenés <code className="text-[11px]">VITE_API_BASE</code> en <code className="text-[11px]">.env.local</code>: ese
                    servidor debe ser la versión nueva del API.
                  </span>
                )}
              </p>
            )}
            {accountId && totals.length > 0 && (
              <div className="border border-subtle rounded-lg table-scroll">
                <table className="w-full text-sm min-w-[280px]">
                  <thead>
                    <tr className="bg-surface text-left text-fg-muted border-b">
                      <th className="px-3 py-2">Divisa</th>
                      <th className="px-3 py-2">Formato</th>
                      <th className="px-3 py-2 text-right">Saldo sistema</th>
                      <th className="px-3 py-2 text-right">Conteo real</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.map((t, idx) => {
                      const k = totalRowKey(t, idx);
                      return (
                        <tr key={k} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{t.currency_code}</td>
                          <td className="px-3 py-2 text-fg">{formatLabel(t.format)}</td>
                          <td className="px-3 py-2 text-right font-mono text-fg">{formatMoneyAR(t.balance)}</td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="text"
                              inputMode="decimal"
                              className="w-28 border border-subtle rounded px-2 py-1 text-right font-mono text-sm"
                              placeholder="0"
                              value={counts[k] ?? ''}
                              onChange={(e) =>
                                setCounts((c) => ({ ...c, [k]: e.target.value }))
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
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
              className="px-4 py-2 bg-brand text-white text-sm rounded hover:bg-brand-hover disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Registrar arqueo'}
            </button>
            {msg && <p className="text-sm text-success">{msg}</p>}
            {err && <p className="text-sm text-error">{err}</p>}
          </form>
        </section>
      )}

      {canView && (
        <section>
          <h3 className="text-sm font-semibold text-fg mb-1">Historial</h3>
          <p className="text-xs text-fg-muted mb-3">
            Arqueos registrados antes del desglose efectivo/digital pueden figurar solo como efectivo en formato (dato histórico).
          </p>
          <div className="flex flex-wrap gap-3 mb-4">
            <select
              value={listFilterAccount}
              onChange={(e) => setListFilterAccount(e.target.value)}
              className="border border-subtle rounded px-2 py-1.5 text-sm"
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
              className="border border-subtle rounded px-2 py-1.5 text-sm"
              placeholder="Desde"
            />
            <input
              type="date"
              value={listTo}
              onChange={(e) => setListTo(e.target.value)}
              className="border border-subtle rounded px-2 py-1.5 text-sm"
              placeholder="Hasta"
            />
            <button
              type="button"
              onClick={() => void loadList()}
              className="px-3 py-1.5 text-sm border border-subtle rounded hover:bg-surface"
            >
              Aplicar filtros
            </button>
          </div>
          {loadingList && <p className="text-sm text-fg-muted">Cargando…</p>}
          {!loadingList && arqueos.length === 0 && <p className="text-sm text-fg-subtle">Sin arqueos.</p>}
          <div className="space-y-6">
            {arqueos.map((aq) => (
              <div key={aq.id} className="border border-subtle rounded-lg overflow-hidden bg-elevated">
                <div className="bg-surface px-4 py-2 border-b text-sm">
                  <span className="font-semibold text-fg">{aq.account_name}</span>
                  <span className="text-fg-muted mx-2">·</span>
                  <span className="text-fg-muted">Corte {aq.arqueo_date}</span>
                  <span className="text-fg-muted mx-2">·</span>
                  <span className="text-fg-muted text-xs">{aq.created_by_username || aq.created_by_user_id}</span>
                  <span className="text-fg-subtle text-xs ml-2">{new Date(aq.created_at).toLocaleString('es-AR')}</span>
                  {aq.note && <p className="text-xs text-fg-muted mt-1">Nota: {aq.note}</p>}
                </div>
                <div className="table-scroll">
                <table className="w-full text-sm min-w-[380px]">
                  <thead>
                    <tr className="text-left text-fg-muted border-b">
                      <th className="px-4 py-2">Divisa</th>
                      <th className="px-4 py-2">Formato</th>
                      <th className="px-4 py-2 text-right">Sistema (snapshot)</th>
                      <th className="px-4 py-2 text-right">Conteo</th>
                      <th className="px-4 py-2 text-right">Dif.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aq.lines.map((ln) => {
                      const d = parseFloat(ln.difference);
                      const rowK = lineKey(ln.currency_id, ln.format || 'CASH');
                      return (
                        <tr key={rowK} className="border-b last:border-0">
                          <td className="px-4 py-2 font-medium">{ln.currency_code}</td>
                          <td className="px-4 py-2 text-fg-muted">{formatLabel(ln.format || 'CASH')}</td>
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
