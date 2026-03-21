import { useState, useEffect, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';

interface ClientListItem {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  phone: string;
  dni: string;
  active: boolean;
  cc_enabled: boolean;
}

interface ClientDetail {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  phone: string;
  dni: string;
  address_street: string;
  address_number: string;
  address_floor: string;
  reference_contact: string;
  referred_by: string;
  active: boolean;
  cc_enabled: boolean;
}

interface Currency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface CCBalanceAdjustmentInput {
  currency_id: string;
  amount: string;
  reason: string;
}

interface Props {
  client: ClientListItem | null;
  onClose: () => void;
  onSaved: (newId?: string) => void;
}

export default function ClientFormModal({ client, onClose, onSaved }: Props) {
  const isEdit = !!client;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dni, setDni] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressNumber, setAddressNumber] = useState('');
  const [addressFloor, setAddressFloor] = useState('');
  const [referenceContact, setReferenceContact] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [ccEnabled, setCcEnabled] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [ccAdjustments, setCcAdjustments] = useState<CCBalanceAdjustmentInput[]>([]);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  useEffect(() => {
    api.get<Currency[]>('/currencies')
      .then((list) => setCurrencies((list || []).filter((c) => c.active)))
      .catch(() => setCurrencies([]));
  }, []);

  useEffect(() => {
    if (!client) return;
    setLoadingDetail(true);
    api
      .get<ClientDetail>(`/clients/${client.id}`)
      .then((d) => {
        setFirstName(d.first_name);
        setLastName(d.last_name);
        setPhone(d.phone);
        setDni(d.dni);
        setAddressStreet(d.address_street);
        setAddressNumber(d.address_number);
        setAddressFloor(d.address_floor);
        setReferenceContact(d.reference_contact);
        setReferredBy(d.referred_by);
        setCcEnabled(d.cc_enabled);
      })
      .catch(() => setError('Error al cargar datos del cliente.'))
      .finally(() => setLoadingDetail(false));
  }, [client]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (
      !firstName.trim() || !lastName.trim() || !phone.trim() || !dni.trim() ||
      !addressStreet.trim() || !addressNumber.trim() || !addressFloor.trim() ||
      !referenceContact.trim() || !referredBy.trim()
    ) {
      setError('Todos los campos son obligatorios.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        dni: dni.trim(),
        address_street: addressStreet.trim(),
        address_number: addressNumber.trim(),
        address_floor: addressFloor.trim(),
        reference_contact: referenceContact.trim(),
        referred_by: referredBy.trim(),
        cc_enabled: ccEnabled,
        cc_balance_adjustments: ccEnabled
          ? ccAdjustments
              .filter((line) => line.currency_id && line.amount.trim() !== '')
              .map((line) => ({
                currency_id: line.currency_id,
                amount: line.amount.trim(),
                reason: line.reason.trim(),
              }))
          : [],
      };

      if (isEdit) {
        await api.put(`/clients/${client!.id}`, payload);
        onSaved();
      } else {
        const result = await api.post<{ id: string }>('/clients', payload);
        onSaved(result.id);
      }
    } catch (err: any) {
      setError(err?.message || 'Error al guardar cliente.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  function addCCAdjustmentLine() {
    setCcAdjustments((prev) => [...prev, { currency_id: '', amount: '', reason: '' }]);
  }

  function removeCCAdjustmentLine(index: number) {
    setCcAdjustments((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCCAdjustmentLine(index: number, field: keyof CCBalanceAdjustmentInput, value: string) {
    setCcAdjustments((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>

        {loadingDetail ? (
          <p className="text-gray-500 text-sm">Cargando...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Apellido</label>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">DNI</label>
                <input type="text" value={dni} onChange={(e) => setDni(e.target.value)} className={inputCls} required />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Calle</label>
                <input type="text" value={addressStreet} onChange={(e) => setAddressStreet(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número</label>
                <input type="text" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Piso</label>
                <input type="text" value={addressFloor} onChange={(e) => setAddressFloor(e.target.value)} className={inputCls} required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contacto de referencia</label>
                <input type="text" value={referenceContact} onChange={(e) => setReferenceContact(e.target.value)} className={inputCls} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recomendado por</label>
                <input type="text" value={referredBy} onChange={(e) => setReferredBy(e.target.value)} className={inputCls} required />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ccEnabled}
                  onChange={(e) => setCcEnabled(e.target.checked)}
                  className="rounded"
                />
                CC habilitada
              </label>
            </div>

            {ccEnabled && (
              <div className="border border-gray-200 rounded-md p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {isEdit ? 'Ajustes de CC (delta)' : 'Saldo inicial de CC'}
                    </p>
                    <p className="text-xs text-gray-500">
                      Usá signo: positivo = cliente a favor, negativo = cliente debe.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addCCAdjustmentLine}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Agregar línea
                  </button>
                </div>

                {ccAdjustments.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Sin líneas cargadas. Si no agregás líneas, la CC inicia/sigue en cero.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {ccAdjustments.map((line, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-4">
                          <label className="block text-xs text-gray-500 mb-1">Divisa</label>
                          <select
                            value={line.currency_id}
                            onChange={(e) => updateCCAdjustmentLine(idx, 'currency_id', e.target.value)}
                            className={inputCls}
                          >
                            <option value="">— Seleccionar —</option>
                            {currencies.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code} — {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs text-gray-500 mb-1">Monto (+/-)</label>
                          <input
                            type="text"
                            value={line.amount}
                            onChange={(e) => updateCCAdjustmentLine(idx, 'amount', e.target.value)}
                            placeholder="Ej: -1000 / 2500"
                            className={inputCls}
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs text-gray-500 mb-1">Motivo</label>
                          <input
                            type="text"
                            value={line.reason}
                            onChange={(e) => updateCCAdjustmentLine(idx, 'reason', e.target.value)}
                            placeholder={isEdit ? 'Ajuste manual' : 'Saldo inicial'}
                            className={inputCls}
                          />
                        </div>
                        <div className="col-span-1">
                          <button
                            type="button"
                            onClick={() => removeCCAdjustmentLine(idx)}
                            className="w-full border border-red-200 text-red-600 rounded-md py-2 text-xs hover:bg-red-50"
                            title="Eliminar línea"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
