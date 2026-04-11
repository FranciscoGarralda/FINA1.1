import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import ThemeToggle from '../components/common/ThemeToggle';

interface LoginResponse {
  token: string;
  role: string;
  user_id: string;
}

interface ApiError {
  error?: string;
  message?: string;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.',
  ACCOUNT_LOCKED:      'Cuenta bloqueada temporalmente. Intentá de nuevo en 15 minutos.',
  ACCOUNT_INACTIVE:    'Tu cuenta está desactivada. Contactá al administrador.',
  TOO_MANY_REQUESTS:   'Demasiados intentos. Esperá un minuto e intentá de nuevo.',
};

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSessionBanner, setShowSessionBanner] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const st = location.state as { sessionExpired?: boolean } | null;
    if (st?.sessionExpired) setShowSessionBanner(true);
  }, [location.state]);

  useEffect(() => {
    if (!showSessionBanner) return;
    const t = window.setTimeout(() => setShowSessionBanner(false), 6000);
    return () => window.clearTimeout(t);
  }, [showSessionBanner]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.post<LoginResponse>('/login', { username, password });
      login(data.token, data.role, data.user_id);
      const redirectTo = sessionStorage.getItem('redirect_after_login');
      sessionStorage.removeItem('redirect_after_login');
      navigate(redirectTo && redirectTo !== '/login' ? redirectTo : '/inicio', { replace: true });
    } catch (err: unknown) {
      const code = (err as ApiError)?.error ?? '';
      setError(AUTH_ERROR_MESSAGES[code] ?? 'Error al iniciar sesión. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center bg-app px-4 pb-[env(safe-area-inset-bottom,0px)]">
      <div className="absolute top-4 right-4 pt-[env(safe-area-inset-top,0px)]">
        <ThemeToggle />
      </div>
      <div className="card-surface w-full max-w-sm shadow-none">
        <h1 className="text-h1 text-center mb-6 text-fg tracking-wide">Fina</h1>
        {showSessionBanner && (
          <p className="text-sm text-fg-muted border border-subtle rounded-md p-3 mb-4" role="status">
            Tu sesión expiró. Por favor volvé a ingresar.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setShowSessionBanner(false);
                setUsername(e.target.value);
              }}
              className="input-field"
              required
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-fg-muted mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setShowSessionBanner(false);
                setPassword(e.target.value);
              }}
              className="input-field"
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-error text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="btn-touch btn-primary w-full">
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
