import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { api } from '../api/client';

interface AuthState {
  token: string | null;
  role: string | null;
  userId: string | null;
  permissions: string[];
}

interface AuthContextType extends AuthState {
  login: (token: string, role: string, userId: string) => void;
  logout: () => void;
  can: (permission: string, fallbackRoles?: string[]) => boolean;
  refreshPermissions: () => Promise<void>;
  isSuperAdmin: boolean;
  canViewSettings: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialPermissionsRaw = localStorage.getItem('permissions');
  const initialPermissions = initialPermissionsRaw ? JSON.parse(initialPermissionsRaw) as string[] : [];

  const [auth, setAuth] = useState<AuthState>({
    token: localStorage.getItem('token'),
    role: localStorage.getItem('role'),
    userId: localStorage.getItem('user_id'),
    permissions: initialPermissions,
  });

  const refreshInFlightRef = useRef(false);
  const login = (token: string, role: string, userId: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('role', role);
    localStorage.setItem('user_id', userId);
    localStorage.removeItem('permissions');
    setAuth({ token, role, userId, permissions: [] });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user_id');
    localStorage.removeItem('permissions');
    setAuth({ token: null, role: null, userId: null, permissions: [] });
  };

  const refreshPermissions = async () => {
    if (!auth.token) return;
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const data = await api.get<{ permissions: string[] }>('/auth/me/permissions');
      const permissions = data?.permissions ?? [];
      localStorage.setItem('permissions', JSON.stringify(permissions));
      setAuth((prev) => ({ ...prev, permissions }));
    } catch {
      // Keep role-based fallback behavior when endpoint/matrix is not ready.
      setAuth((prev) => ({ ...prev, permissions: [] }));
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (auth.token) {
      refreshPermissions();
    }
  }, [auth.token]);

  const can = (permission: string, fallbackRoles?: string[]) => {
    if (!permission) return true;
    if (auth.permissions.includes(permission)) return true;
    if (fallbackRoles && fallbackRoles.includes(auth.role ?? '')) return true;
    return fallbackAllows(auth.role, permission);
  };

  const isSuperAdmin = auth.role === 'SUPERADMIN';
  const canViewSettings = can('settings.view');

  const value = useMemo(() => ({
    ...auth,
    login,
    logout,
    can,
    refreshPermissions,
    isSuperAdmin,
    canViewSettings,
  }), [auth, isSuperAdmin, canViewSettings]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const fallbackPermissionByRole: Record<string, Set<string>> = {
  SUPERADMIN: new Set([
    'dashboard.view', 'settings.view', 'settings.edit',
    'users.view', 'users.create', 'users.edit', 'users.toggle_active', 'users.reset_password',
    'permissions.view_user', 'permissions.edit_user', 'permissions.reset_user_to_default',
    'currencies.view', 'currencies.create', 'currencies.edit', 'currencies.toggle_active',
    'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.toggle_active', 'accounts.currencies.edit',
    'clients.view', 'clients.create', 'clients.edit', 'clients.toggle_active',
    'cc.view', 'cc.export_csv', 'movements.view', 'movements.detail.view',
    'operations.create_header', 'operations.compra.execute', 'operations.venta.execute', 'operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute', 'operations.transferencia.execute', 'operations.ingreso_capital.execute',
    'operations.retiro_capital.execute', 'operations.gasto.execute', 'operations.pago_cc_cruzado.execute',
    'pending.view', 'pending.resolve', 'pending.cancel', 'pending.opening.create',
    'reportes.view',
    'profile.view', 'profile.change_password', 'profile.change_pin',
    'cash_position.view', 'cash_arqueo.view', 'cash_arqueo.create',
  ]),
  ADMIN: new Set([
    'dashboard.view', 'settings.view',
    'users.view',
    'currencies.view', 'currencies.create', 'currencies.edit', 'currencies.toggle_active',
    'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.toggle_active', 'accounts.currencies.edit',
    'clients.view', 'clients.create', 'clients.edit', 'clients.toggle_active',
    'cc.view', 'cc.export_csv', 'movements.view', 'movements.detail.view',
    'operations.create_header', 'operations.compra.execute', 'operations.venta.execute', 'operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute', 'operations.transferencia.execute', 'operations.ingreso_capital.execute',
    'operations.retiro_capital.execute', 'operations.gasto.execute', 'operations.pago_cc_cruzado.execute',
    'pending.view', 'pending.resolve', 'pending.cancel', 'pending.opening.create',
    'reportes.view',
    'profile.view', 'profile.change_password',
    'cash_position.view', 'cash_arqueo.view', 'cash_arqueo.create',
  ]),
  SUBADMIN: new Set([
    'dashboard.view', 'settings.view',
    'users.view', 'users.create', 'users.edit', 'users.reset_password',
    'currencies.view', 'currencies.create', 'currencies.edit', 'currencies.toggle_active',
    'accounts.view', 'accounts.create', 'accounts.edit', 'accounts.toggle_active', 'accounts.currencies.edit',
    'clients.view', 'clients.create', 'clients.edit', 'clients.toggle_active',
    'cc.view', 'cc.export_csv', 'movements.view', 'movements.detail.view',
    'operations.create_header', 'operations.compra.execute', 'operations.venta.execute', 'operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute', 'operations.transferencia.execute', 'operations.ingreso_capital.execute',
    'operations.retiro_capital.execute', 'operations.gasto.execute', 'operations.pago_cc_cruzado.execute',
    'pending.view', 'pending.resolve', 'pending.cancel', 'pending.opening.create',
    'reportes.view',
    'profile.view', 'profile.change_password',
    'cash_position.view', 'cash_arqueo.view', 'cash_arqueo.create',
  ]),
  OPERATOR: new Set([
    'dashboard.view',
    'currencies.view', 'accounts.view',
    'clients.view', 'clients.create', 'clients.edit', 'clients.toggle_active',
    'cc.view', 'cc.export_csv', 'movements.view', 'movements.detail.view',
    'operations.create_header', 'operations.compra.execute', 'operations.venta.execute', 'operations.arbitraje.execute',
    'operations.transferencia_entre_cuentas.execute', 'operations.transferencia.execute', 'operations.ingreso_capital.execute',
    'operations.retiro_capital.execute', 'operations.gasto.execute', 'operations.pago_cc_cruzado.execute',
    'pending.view', 'pending.resolve', 'pending.cancel',
    'profile.view', 'profile.change_password',
    'cash_position.view', 'cash_arqueo.view', 'cash_arqueo.create',
  ]),
  COURIER: new Set([
    'dashboard.view',
    'clients.view',
    'pending.view', 'pending.resolve', 'pending.cancel',
    'profile.view', 'profile.change_password', 'profile.change_pin',
  ]),
};

function fallbackAllows(role: string | null, permission: string): boolean {
  if (!role) return false;
  return fallbackPermissionByRole[role]?.has(permission) ?? false;
}
