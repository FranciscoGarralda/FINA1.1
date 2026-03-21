import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';

interface PermissionItem {
  key: string;
  module: string;
  label: string;
  description?: string;
  source: 'USER' | 'ROLE' | 'FALLBACK';
  allowed: boolean;
}

interface Props {
  userId: string;
  username: string;
  onClose: () => void;
}

export default function UserPermissionsModal({ userId, username, onClose }: Props) {
  const [items, setItems] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  const fetchData = async () => {
    setLoading(true);
    setMsg('');
    try {
      const data = await api.get<{ items: PermissionItem[] }>(`/users/${userId}/permissions`);
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
    fetchData();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, [userId]);

  const grouped = useMemo(() => {
    const m: Record<string, PermissionItem[]> = {};
    for (const item of items) {
      if (!m[item.module]) m[item.module] = [];
      m[item.module].push(item);
    }
    return m;
  }, [items]);

  const modules = useMemo(() => Object.keys(grouped).sort(), [grouped]);

  const toggle = (key: string) => {
    setItems((prev) => prev.map((i) => i.key === key ? { ...i, allowed: !i.allowed } : i));
  };

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.put(`/users/${userId}/permissions`, {
        items: items.map((i) => ({ key: i.key, allowed: i.allowed })),
      });
      setMsg('Permisos guardados.');
      setMsgType('ok');
      await fetchData();
    } catch {
      setMsg('No se pudieron guardar los permisos.');
      setMsgType('err');
    } finally {
      setSaving(false);
    }
  };

  const resetOverrides = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.delete(`/users/${userId}/permissions/overrides`);
      setMsg('Permisos restaurados al rol.');
      setMsgType('ok');
      await fetchData();
    } catch {
      setMsg('No se pudieron restaurar los permisos.');
      setMsgType('err');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-4xl p-6 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Permisos de usuario</h2>
            <p className="text-sm text-gray-500">{username}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Cargando permisos...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400">No hay permisos para mostrar.</p>
        ) : (
          <div className="overflow-auto space-y-4 pr-1">
            {modules.map((moduleName) => (
              <div key={moduleName} className="border border-gray-200 rounded-md p-3">
                <h4 className="text-sm font-semibold text-gray-700 mb-2 capitalize">{moduleName}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {grouped[moduleName].map((item) => (
                    <label key={item.key} className="flex items-center justify-between border border-gray-100 rounded px-2 py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">{item.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          item.source === 'USER'
                            ? 'bg-blue-100 text-blue-700'
                            : item.source === 'ROLE'
                            ? 'bg-gray-100 text-gray-600'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {item.source === 'USER' ? 'Usuario' : item.source === 'ROLE' ? 'Rol' : 'Fallback'}
                        </span>
                      </div>
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
        )}

        <div className="pt-4 mt-4 border-t flex flex-wrap items-center gap-3">
          <button
            onClick={save}
            disabled={saving || loading || items.length === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving ? 'Guardando...' : 'Guardar permisos'}
          </button>
          <button
            onClick={resetOverrides}
            disabled={saving || loading || items.length === 0}
            className="px-4 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50 disabled:opacity-50 transition"
          >
            Restaurar permisos al rol
          </button>
          {msg && (
            <span className={`text-xs ${msgType === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
