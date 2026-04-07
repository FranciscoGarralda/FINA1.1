import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useEffect, useState } from 'react';

import LoginPage from './pages/LoginPage';
import InicioPage from './pages/InicioPage';
import PosicionCajaPage from './pages/PosicionCajaPage';
import CashArqueosPage from './pages/CashArqueosPage';
import NuevaOperacionPage from './pages/NuevaOperacionPage';
import MovimientosPage from './pages/MovimientosPage';
import MovimientoDetallePage from './pages/MovimientoDetallePage';
import PendientesPage from './pages/PendientesPage';
import ReportesPage from './pages/ReportesPage';
import PosicionesPage from './pages/PosicionesPage';
import PosicionesClientePage from './pages/PosicionesClientePage';
import ClientesPage from './pages/ClientesPage';
import CuentasPage from './pages/CuentasPage';
import DivisasPage from './pages/DivisasPage';
import UsuariosPage from './pages/UsuariosPage';
import ConfiguracionPage from './pages/ConfiguracionPage';
import MiPerfilPage from './pages/MiPerfilPage';
import AppLayout from './components/layout/AppLayout';

const FORCED_INITIAL_ROUTE = '/inicio';
const FORBIDDEN_ROUTE = '/forbidden';
const DASHBOARD_ROLES = ['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER'];

function ForbiddenBanner() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
      No tenés permisos para acceder.
    </div>
  );
}

function ProtectedRoute({
  children,
  requiredPermission,
  fallbackRoles,
}: {
  children: React.ReactNode;
  requiredPermission?: string;
  fallbackRoles?: string[];
}) {
  const { token, can } = useAuth();
  const location = useLocation();

  if (!token) return <Navigate to="/login" replace />;

  if (requiredPermission && !can(requiredPermission, fallbackRoles)) {
    const fallbackPath = location.pathname === FORCED_INITIAL_ROUTE ? FORBIDDEN_ROUTE : FORCED_INITIAL_ROUTE;
    return <Navigate to={fallbackPath} replace state={{ forbidden: true, from: location.pathname }} />;
  }

  return <>{children}</>;
}

function ForbiddenStatePage() {
  const location = useLocation();
  const from = (location.state as { from?: string } | undefined)?.from;
  return (
    <div className="bg-white border border-red-200 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-2">Acceso restringido</h2>
      <p className="text-sm text-gray-600">
        No tenés permisos para acceder a esta sección{from ? ` (${from})` : ''}.
      </p>
    </div>
  );
}

function AppShell() {
  const location = useLocation();
  const showForbidden = location.state?.forbidden === true;

  useEffect(() => {
    if (showForbidden) {
      window.history.replaceState({}, '');
    }
  }, [showForbidden]);

  return (
    <>
      {showForbidden && <ForbiddenBanner />}
      <AppLayout />
    </>
  );
}

export default function App() {
  const { token } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to={FORCED_INITIAL_ROUTE} replace /> : <LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route
          path="/inicio"
          element={
            <ProtectedRoute requiredPermission="dashboard.view" fallbackRoles={DASHBOARD_ROLES}>
              <InicioPage />
            </ProtectedRoute>
          }
        />
        <Route path={FORBIDDEN_ROUTE} element={<ForbiddenStatePage />} />
        <Route
          path="/mi-perfil"
          element={
            <ProtectedRoute requiredPermission="profile.view">
              <MiPerfilPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/nueva-operacion"
          element={
            <ProtectedRoute requiredPermission="operations.create_header" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <NuevaOperacionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/movimientos"
          element={
            <ProtectedRoute requiredPermission="movements.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <MovimientosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/movimientos/:id"
          element={
            <ProtectedRoute requiredPermission="movements.detail.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <MovimientoDetallePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pendientes"
          element={
            <ProtectedRoute requiredPermission="pending.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER']}>
              <PendientesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reportes"
          element={
            <ProtectedRoute requiredPermission="reportes.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN']}>
              <ReportesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/posiciones"
          element={
            <ProtectedRoute requiredPermission="cc.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <PosicionesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/posiciones/:clientId"
          element={
            <ProtectedRoute requiredPermission="cc.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <PosicionesClientePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/clientes"
          element={
            <ProtectedRoute requiredPermission="clients.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR', 'COURIER']}>
              <ClientesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/cuentas"
          element={
            <ProtectedRoute requiredPermission="accounts.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <CuentasPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/posicion-caja"
          element={
            <ProtectedRoute requiredPermission="cash_position.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <PosicionCajaPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/caja-arqueos"
          element={
            <ProtectedRoute requiredPermission="cash_arqueo.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <CashArqueosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/divisas"
          element={
            <ProtectedRoute requiredPermission="currencies.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN', 'OPERATOR']}>
              <DivisasPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/usuarios"
          element={
            <ProtectedRoute requiredPermission="users.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN']}>
              <UsuariosPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/configuracion"
          element={
            <ProtectedRoute requiredPermission="settings.view" fallbackRoles={['SUPERADMIN', 'ADMIN', 'SUBADMIN']}>
              <ConfiguracionPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to={token ? FORCED_INITIAL_ROUTE : '/login'} replace />} />
    </Routes>
  );
}
