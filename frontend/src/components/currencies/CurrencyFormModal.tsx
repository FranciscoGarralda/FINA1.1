import { useState, useEffect, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';

interface Currency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface Props {
  currency: Currency | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function CurrencyFormModal({ currency, onClose, onSaved }: Props) {
  const isEdit = !!currency;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (currency) {
      setCode(currency.code);
      setName(currency.name);
    }
  }, [currency]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      setError('El código es obligatorio.');
      return;
    }
    if (!/^[A-Z]{2,6}$/.test(trimmedCode)) {
      setError('El código debe estar en mayúsculas (2 a 6 caracteres).');
      return;
    }
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }

    setSaving(true);
    try {
      const payload = { code: trimmedCode, name: name.trim() };
      if (isEdit) {
        await api.put(`/currencies/${currency!.id}`, payload);
      } else {
        await api.post('/currencies', payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Error al guardar divisa.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Editar Divisa' : 'Nueva Divisa'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="USD"
              maxLength={6}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dólar estadounidense"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-touch border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-touch bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
