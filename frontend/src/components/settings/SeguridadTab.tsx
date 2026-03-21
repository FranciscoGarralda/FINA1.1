import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

interface SecuritySettings {
  lockout_enabled: boolean;
  lockout_max_attempts: number;
  lockout_minutes: number;
  pin_enabled_for_courier: boolean;
  pin_min_length: number;
  pin_max_length: number;
}

const DEFAULTS: SecuritySettings = {
  lockout_enabled: true,
  lockout_max_attempts: 5,
  lockout_minutes: 15,
  pin_enabled_for_courier: true,
  pin_min_length: 4,
  pin_max_length: 8,
};

export default function SeguridadTab() {
  const { isSuperAdmin } = useAuth();
  const [settings, setSettings] = useState<SecuritySettings>(DEFAULTS);
  const [saved, setSaved] = useState<SecuritySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get<Record<string, any>>('/settings').then((data) => {
      const s: SecuritySettings = {
        lockout_enabled: data.lockout_enabled ?? DEFAULTS.lockout_enabled,
        lockout_max_attempts: data.lockout_max_attempts ?? DEFAULTS.lockout_max_attempts,
        lockout_minutes: data.lockout_minutes ?? DEFAULTS.lockout_minutes,
        pin_enabled_for_courier: data.pin_enabled_for_courier ?? DEFAULTS.pin_enabled_for_courier,
        pin_min_length: data.pin_min_length ?? DEFAULTS.pin_min_length,
        pin_max_length: data.pin_max_length ?? DEFAULTS.pin_max_length,
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
      const s: SecuritySettings = {
        lockout_enabled: data.lockout_enabled,
        lockout_max_attempts: data.lockout_max_attempts,
        lockout_minutes: data.lockout_minutes,
        pin_enabled_for_courier: data.pin_enabled_for_courier,
        pin_min_length: data.pin_min_length,
        pin_max_length: data.pin_max_length,
      };
      setSettings(s);
      setSaved(s);
      setMessage('Configuración guardada correctamente.');
    } catch (err: any) {
      setMessage(err?.message || 'Valores de configuración inválidos.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSettings(saved);
    setMessage('');
  };

  if (loading) return <p className="text-gray-500">Cargando...</p>;

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-lg font-semibold mb-4">Seguridad</h2>

      <div className="space-y-5">
        <Toggle
          label="Bloqueo por intentos fallidos"
          checked={settings.lockout_enabled}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, lockout_enabled: v })}
        />
        <NumberInput
          label="Intentos máximos antes de bloqueo"
          value={settings.lockout_max_attempts}
          min={1}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, lockout_max_attempts: v })}
        />
        <NumberInput
          label="Minutos de bloqueo"
          value={settings.lockout_minutes}
          min={1}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, lockout_minutes: v })}
        />
        <Toggle
          label="PIN habilitado para courier"
          checked={settings.pin_enabled_for_courier}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, pin_enabled_for_courier: v })}
        />
        <NumberInput
          label="Largo mínimo de PIN"
          value={settings.pin_min_length}
          min={4}
          max={8}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, pin_min_length: v })}
        />
        <NumberInput
          label="Largo máximo de PIN"
          value={settings.pin_max_length}
          min={4}
          max={8}
          disabled={!isSuperAdmin}
          onChange={(v) => setSettings({ ...settings, pin_max_length: v })}
        />
      </div>

      {message && (
        <p className={`mt-4 text-sm ${message.includes('correctamente') ? 'text-green-600' : 'text-red-600'}`}>
          {message}
        </p>
      )}

      {isSuperAdmin && (
        <div className="mt-6 flex gap-3">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button
            onClick={handleCancel}
            disabled={!dirty}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-gray-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </label>
  );
}

function NumberInput({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min?: number; max?: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-sm text-gray-700">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right disabled:bg-gray-100"
      />
    </label>
  );
}
