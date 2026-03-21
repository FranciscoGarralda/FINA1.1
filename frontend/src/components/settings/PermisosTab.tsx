import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';

const ROLES = ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER'] as const;
type RoleName = (typeof ROLES)[number];

interface PermissionItem {
  key: string;
  module: string;
  label: string;
  description?: string;
  allowed: boolean;
}

export default function PermisosTab() {
  const [role, setRole] = useState<RoleName>('ADMIN');
  const [items, setItems] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  const fetchRole = async (nextRole: string) => {
    setLoading(true);
    setMsg('');
    try {
      const data = await api.get<{ role: string; items: PermissionItem[] }>(`/permissions/roles/${nextRole}`);
      setItems(data.items || []);
    } catch {
      setItems([]);
      setMsg('No se pudieron cargar los permisos.');
      setMsgType('err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRole(role);
  }, [role]);

  const grouped = useMemo(() => {
    const m: Record<string, PermissionItem[]> = {};
    for (const item of items) {
      if (!m[item.module]) m[item.module] = [];
      m[item.module].push(item);
    }
    return m;
  }, [items]);

  const moduleNames = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const toggle = (key: string) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, allowed: !i.allowed } : i)));
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`/permissions/roles/${role}`, {
        items: items.map((i) => ({ key: i.key, allowed: i.allowed })),
      });
      setMsg('Permisos guardados.');
      setMsgType('ok');
      await fetchRole(role);
    } catch {
      setMsg('No se pudieron guardar los permisos.');
      setMsgType('err');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Cargando permisos...</p>;
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-400">No hay permisos para mostrar.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-0.5">Rol</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as RoleName)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition"
        >
          {saving ? 'Guardando...' : 'Guardar permisos'}
        </button>
        {msg && (
          <span className={`text-xs ${msgType === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {msg}
          </span>
        )}
      </div>

      {moduleNames.map((moduleName) => (
        <div key={moduleName} className="bg-white rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3 capitalize">{moduleName}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {grouped[moduleName].map((item) => (
              <label key={item.key} className="flex items-center justify-between border border-gray-100 rounded px-2 py-1.5 text-sm">
                <span className="text-gray-700">{item.label}</span>
                <input
                  type="checkbox"
                  checked={item.allowed}
                  onChange={() => toggle(item.key)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
