import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const NAV_ITEMS = [
  { to: '/inicio',          label: 'Inicio',          permission: 'dashboard.view' },
  { to: '/nueva-operacion', label: 'Nueva operación', permission: 'operations.create_header' },
  { to: '/movimientos',     label: 'Movimientos',     permission: 'movements.view' },
  { to: '/pendientes',      label: 'Pendientes',      permission: 'pending.view' },
  { to: '/reportes',        label: 'Reportes',        permission: 'reportes.view' },
  { to: '/posiciones',      label: 'Estado CC',       permission: 'cc.view' },
  { to: '/clientes',        label: 'Clientes',        permission: 'clients.view' },
  { to: '/cuentas',         label: 'Cuentas',         permission: 'accounts.view' },
  { to: '/caja-arqueos',    label: 'Arqueos caja',    permission: 'cash_arqueo.view' },
  { to: '/divisas',         label: 'Divisas',         permission: 'currencies.view' },
  { to: '/usuarios',        label: 'Usuarios',        permission: 'users.view' },
  { to: '/configuracion',   label: 'Configuración',   permission: 'settings.view' },
  { to: '/mi-perfil',       label: 'Mi perfil',       permission: 'profile.view' },
];

type HistoryIdxState = { idx?: number; usr?: unknown; key?: string };

export default function AppLayout() {
  const { logout, role, can } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  /** Retroceso real en el stack del router (state.idx); si no hay entrada anterior, /inicio. */
  function handleBack() {
    const idx = (window.history.state as HistoryIdxState | null)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate('/inicio', { replace: true });
  }

  function handleNewOperationClick() {
    navigate('/nueva-operacion', { state: { newOperationResetToken: `${Date.now()}-${Math.random()}` } });
  }

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) {
      document.body.style.overflow = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.overscrollBehavior = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = '';
      document.body.style.overscrollBehavior = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.overscrollBehavior = '';
    };
  }, [sidebarOpen]);

  const visibleItems = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <div className="min-h-dvh w-full flex flex-col">
      {/* Barra app: fija (evita fallos de sticky con overflow-x en html/body) */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-white shadow-sm border-b pt-[env(safe-area-inset-top,0px)]">
        <div className="h-14 min-h-[44px] px-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition"
            aria-label="Volver"
            title="Volver"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="flex-1 min-w-0 text-center text-xl font-bold text-gray-800 truncate px-1">Fina</h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition"
              aria-label="Abrir menú"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded max-w-[5.5rem] truncate hidden sm:inline-block">
              {role}
            </span>
          </div>
        </div>
      </header>

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity overscroll-none touch-manipulation"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar drawer */}
      <aside
        className={`fixed top-0 left-0 h-dvh min-h-0 w-64 max-w-[min(16rem,calc(100vw-1rem))] bg-white shadow-lg z-50 transform transition-transform duration-200 ease-in-out flex flex-col border-r border-gray-100 pt-[env(safe-area-inset-top,0px)] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b flex items-center justify-between">
          <span className="text-lg font-bold text-gray-800">Fina</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition"
            aria-label="Cerrar menú"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.to;
            const className = `flex w-full min-h-[44px] items-center text-left px-4 py-2.5 text-sm font-medium transition ${
              isActive
                ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
            }`;

            if (item.to === '/nueva-operacion') {
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={handleNewOperationClick}
                  className={className}
                >
                  {item.label}
                </button>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive: active }) =>
                  `flex min-h-[44px] items-center px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                  }`
                }
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded truncate">{role}</span>
            <button
              onClick={logout}
              className="min-h-[44px] px-3 inline-flex items-center text-sm text-red-600 hover:text-red-800 font-medium transition"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Main: offset = barra (3.5rem) + safe-area superior; sin duplicar insets del body en el eje vertical */}
      <main className="max-w-6xl mx-auto w-full min-w-0 flex-1 px-4 pb-6 pt-[calc(env(safe-area-inset-top,0px)+3.5rem)]">
        <Outlet />
      </main>
    </div>
  );
}
