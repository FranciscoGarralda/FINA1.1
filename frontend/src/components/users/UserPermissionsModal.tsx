import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import FormActionsRow from '../common/FormActionsRow';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import type { UserPermissionMatrixItem, UserPermissionsResponse } from '../../types/userPermissions';

interface Props {
  userId: string;
  username: string;
  onClose: () => void;
}

export default function UserPermissionsModal({ userId, username, onClose }: Props) {
  const [items, setItems] = useState<UserPermissionMatrixItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  const backdropRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({
    containerRef: backdropRef,
    onClose,
    refocusToken: loading ? 'loading' : `ready-${items.length}`,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      const data = await api.get<UserPermissionsResponse>(`/users/${userId}/permissions`);
      setItems(data.items || []);
    } catch {
      setItems([]);
      setMsg('No se pudieron cargar los permisos.');
      setMsgType('err');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useBodyScrollLock(true);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const grouped = useMemo(() => {
    const m: Record<string, UserPermissionMatrixItem[]> = {};
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
    <div ref={backdropRef} className="modal-backdrop">
      <div className="modal-panel modal-enter max-w-4xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] max-h-[min(85vh,calc(100dvh-2rem))] overflow-hidden flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Permisos de usuario</h2>
            <p className="text-sm text-fg-muted">{username}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-surface"
            aria-label="Cerrar"
            title="Cerrar"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-fg-muted">Cargando permisos...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-fg-subtle">No hay permisos para mostrar.</p>
        ) : (
          <div className="overflow-auto space-y-4 pr-1">
            {modules.map((moduleName) => (
              <div key={moduleName} className="border border-subtle rounded-md p-3">
                <h4 className="text-sm font-semibold text-fg mb-2 capitalize">{moduleName}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {grouped[moduleName].map((item) => (
                    <label key={item.key} className="flex items-center justify-between border border-subtle rounded px-2 py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-fg">{item.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          item.source === 'USER'
                            ? 'bg-brand-soft text-brand'
                            : item.source === 'ROLE'
                            ? 'bg-surface text-fg-muted'
                            : 'bg-warning-soft text-warning'
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

        <div className="mt-4 border-t pt-4 space-y-2">
          <FormActionsRow
            variant="modal"
            className="!pt-0"
            primary={
              <button
                type="button"
                onClick={save}
                disabled={saving || loading || items.length === 0}
                className="btn-touch bg-brand text-white rounded-md hover:bg-brand-hover disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar permisos'}
              </button>
            }
            secondary={
              <button
                type="button"
                onClick={resetOverrides}
                disabled={saving || loading || items.length === 0}
                className="btn-touch border border-subtle rounded-md hover:bg-surface disabled:opacity-50"
              >
                Restaurar permisos al rol
              </button>
            }
          />
          {msg && (
            <span className={`block text-xs ${msgType === 'ok' ? 'text-success' : 'text-error'}`}>
              {msg}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
