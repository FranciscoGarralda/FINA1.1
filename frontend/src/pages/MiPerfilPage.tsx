import { useState, useEffect, FormEvent } from 'react';
import { api } from '../api/client';
import ApiErrorBanner from '../components/common/ApiErrorBanner';

interface MeData {
  username: string;
  role: string;
  active: boolean;
  pin_enabled: boolean;
  pin_min_length: number;
  pin_max_length: number;
}

export default function MiPerfilPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [pinSaving, setPinSaving] = useState(false);

  useEffect(() => {
    setLoadError('');
    api
      .get<MeData>('/auth/me')
      .then((data) => {
        setMe(data);
      })
      .catch(() => {
        setLoadError('No se pudo cargar el perfil. Revisá la conexión e intentá de nuevo.');
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (!newPassword) {
      setPwError('La nueva contraseña es obligatoria.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('La nueva contraseña no coincide.');
      return;
    }

    setPwSaving(true);
    try {
      await api.post('/users/me/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwSuccess('Contraseña actualizada.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwError(err?.message || 'Error al cambiar la contraseña.');
    } finally {
      setPwSaving(false);
    }
  };

  const handlePinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setPinError('');
    setPinSuccess('');

    if (!newPin) {
      setPinError('El nuevo PIN es obligatorio.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinError('El nuevo PIN no coincide.');
      return;
    }
    if (me && (newPin.length < me.pin_min_length || newPin.length > me.pin_max_length)) {
      setPinError(`El PIN debe tener entre ${me.pin_min_length} y ${me.pin_max_length} dígitos.`);
      return;
    }

    setPinSaving(true);
    try {
      await api.post('/users/me/change-pin', {
        current_pin: currentPin,
        new_pin: newPin,
      });
      setPinSuccess('PIN actualizado.');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (err: any) {
      setPinError(err?.message || 'Error al cambiar el PIN.');
    } finally {
      setPinSaving(false);
    }
  };

  if (loading) {
    return <p className="text-gray-500">Cargando perfil...</p>;
  }

  if (!me) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-800">Mi perfil</h2>
        <ApiErrorBanner message={loadError || 'No se pudo cargar el perfil.'} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-xl font-semibold text-gray-800">Mi perfil</h2>

      {/* Section A: Info */}
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-700 mb-4">Información</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <dt className="text-sm text-gray-500">Usuario</dt>
            <dd className="text-sm font-medium text-gray-900">{me.username}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Rol</dt>
            <dd className="text-sm font-medium text-gray-900">{me.role}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Estado</dt>
            <dd className={`text-sm font-medium ${me.active ? 'text-green-600' : 'text-red-600'}`}>
              {me.active ? 'Activo' : 'Inactivo'}
            </dd>
          </div>
        </dl>
      </section>

      {/* Section B: Change password */}
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-700 mb-4">Cambiar contraseña</h3>
        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña actual</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Repetir nueva contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              required
            />
          </div>
          {pwError && <p className="text-sm text-red-600">{pwError}</p>}
          {pwSuccess && <p className="text-sm text-green-600">{pwSuccess}</p>}
          <button
            type="submit"
            disabled={pwSaving}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {pwSaving ? 'Guardando...' : 'Guardar contraseña'}
          </button>
        </form>
      </section>

      {/* Section C: Change PIN (conditional) */}
      {me.pin_enabled && (
        <section className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-700 mb-4">Cambiar PIN</h3>
          <form onSubmit={handlePinSubmit} className="space-y-4 max-w-md">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PIN actual</label>
              <input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nuevo PIN</label>
              <input
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
                minLength={me.pin_min_length}
                maxLength={me.pin_max_length}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Repetir nuevo PIN</label>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
                minLength={me.pin_min_length}
                maxLength={me.pin_max_length}
              />
            </div>
            <p className="text-xs text-gray-400">
              Entre {me.pin_min_length} y {me.pin_max_length} dígitos.
            </p>
            {pinError && <p className="text-sm text-red-600">{pinError}</p>}
            {pinSuccess && <p className="text-sm text-green-600">{pinSuccess}</p>}
            <button
              type="submit"
              disabled={pinSaving}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {pinSaving ? 'Guardando...' : 'Guardar PIN'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
