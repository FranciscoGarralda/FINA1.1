import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

interface PolicySettings {
  cc_cross_payment_strict_equal_amount: boolean;
  pending_allow_partial_resolution: boolean;
  cc_allow_positive_balance: boolean;
  cc_allow_overpay: boolean;
}

const DEFAULTS: PolicySettings = {
  cc_cross_payment_strict_equal_amount: true,
  pending_allow_partial_resolution: true,
  cc_allow_positive_balance: true,
  cc_allow_overpay: true,
};

const POLICY_LABELS: { key: keyof PolicySettings; label: string; description: string }[] = [
  {
    key: 'cc_cross_payment_strict_equal_amount',
    label: 'Pago CC cruzado: monto exacto',
    description: 'El monto del pago debe ser igual al monto de cancelación en pagos CC cruzados.',
  },
  {
    key: 'pending_allow_partial_resolution',
    label: 'Resolución parcial de pendientes',
    description: 'Permite resolver un pendiente con un monto menor al total, dejando el resto abierto.',
  },
  {
    key: 'cc_allow_positive_balance',
    label: 'Permitir saldo CC positivo',
    description: 'Permite que el saldo de cuenta corriente de un cliente quede en positivo (a favor del cliente).',
  },
  {
    key: 'cc_allow_overpay',
    label: 'Permitir sobre-cancelación CC',
    description: 'Permite cancelar un monto mayor a la deuda de CC, resultando en saldo positivo.',
  },
];

export default function PoliticasTab() {
  const { isSuperAdmin } = useAuth();
  const [settings, setSettings] = useState<PolicySettings>(DEFAULTS);
  const [saved, setSaved] = useState<PolicySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get<Record<string, any>>('/settings').then((data) => {
      const s: PolicySettings = {
        cc_cross_payment_strict_equal_amount: data.cc_cross_payment_strict_equal_amount ?? DEFAULTS.cc_cross_payment_strict_equal_amount,
        pending_allow_partial_resolution: data.pending_allow_partial_resolution ?? DEFAULTS.pending_allow_partial_resolution,
        cc_allow_positive_balance: data.cc_allow_positive_balance ?? DEFAULTS.cc_allow_positive_balance,
        cc_allow_overpay: data.cc_allow_overpay ?? DEFAULTS.cc_allow_overpay,
      };
      setSettings(s);
      setSaved(s);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = await api.put<Record<string, any>>('/settings', settings);
      const s: PolicySettings = {
        cc_cross_payment_strict_equal_amount: data.cc_cross_payment_strict_equal_amount,
        pending_allow_partial_resolution: data.pending_allow_partial_resolution,
        cc_allow_positive_balance: data.cc_allow_positive_balance,
        cc_allow_overpay: data.cc_allow_overpay,
      };
      setSettings(s);
      setSaved(s);
      setMessage('Políticas guardadas correctamente.');
    } catch (err: any) {
      setMessage(err?.message || 'Error al guardar políticas.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSettings(saved);
    setMessage('');
  };

  if (loading) return <p className="text-fg-muted">Cargando...</p>;

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  return (
    <div className="bg-elevated rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Políticas de Operación</h2>

      <div className="space-y-6">
        {POLICY_LABELS.map(({ key, label, description }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-fg">{label}</p>
              <p className="text-xs text-fg-muted mt-0.5">{description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings[key]}
              disabled={!isSuperAdmin}
              onClick={() => setSettings({ ...settings, [key]: !settings[key] })}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                settings[key] ? 'bg-brand' : 'bg-fg-subtle/25'
              } ${!isSuperAdmin ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-elevated transition-transform ${
                settings[key] ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        ))}
      </div>

      {message && (
        <p className={`mt-4 text-sm ${message.includes('correctamente') ? 'text-success' : 'text-error'}`}>
          {message}
        </p>
      )}

      {isSuperAdmin && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="bg-brand text-white px-4 py-2 rounded-md hover:bg-brand-hover disabled:opacity-50 text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button
            onClick={handleCancel}
            disabled={!dirty}
            className="border border-subtle text-fg px-4 py-2 rounded-md hover:bg-surface disabled:opacity-50 text-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
