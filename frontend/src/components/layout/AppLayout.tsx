import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../common/ThemeToggle';

const NAV_ITEMS = [
  { to: '/inicio', label: 'Inicio', permission: 'dashboard.view' },
  { to: '/nueva-operacion', label: 'Nueva operación', permission: 'operations.create_header' },
  { to: '/movimientos', label: 'Movimientos', permission: 'movements.view' },
  { to: '/pendientes', label: 'Pendientes', permission: 'pending.view' },
  { to: '/posiciones', label: 'Estado CC', permission: 'cc.view' },
  { to: '/clientes', label: 'Clientes', permission: 'clients.view' },
  { to: '/cuentas', label: 'Cuentas', permission: 'accounts.view' },
  { to: '/posicion-caja', label: 'Posición de caja', permission: 'cash_position.view' },
  { to: '/caja-arqueos', label: 'Arqueos caja', permission: 'cash_arqueo.view' },
  { to: '/divisas', label: 'Divisas', permission: 'currencies.view' },
  { to: '/usuarios', label: 'Usuarios', permission: 'users.view' },
  { to: '/configuracion', label: 'Configuración', permission: 'settings.view' },
  { to: '/mi-perfil', label: 'Mi perfil', permission: 'profile.view' },
];

type HistoryIdxState = { idx?: number; usr?: unknown; key?: string };

const navItemBase =
  'flex w-full min-h-[44px] items-center text-left px-4 py-2.5 text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-interaction ease-out';

const navItemActive =
  'bg-brand-soft text-brand border-r-2 border-brand shadow-nav-glow';

const navItemInactive = 'text-fg-muted border-r-2 border-transparent hover:bg-overlay-hover hover:text-fg';

export default function AppLayout() {
  const { logout, role, can } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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
    <div className="min-h-dvh w-full flex flex-col bg-app">
      <header className="fixed top-0 left-0 right-0 z-30 border-b border-subtle bg-elevated pt-[env(safe-area-inset-top,0px)] transition-colors duration-interaction ease-out">
        <div className="h-12 min-h-[44px] px-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleBack}
              className="shrink-0 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-control text-fg-muted hover:text-fg hover:bg-overlay-hover transition-colors duration-interaction ease-out"
              aria-label="Volver"
              title="Volver"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-control text-fg-muted hover:text-fg hover:bg-overlay-hover transition-colors duration-interaction ease-out"
              aria-label="Abrir menú"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
          <h1 className="flex-1 min-w-0 text-center text-h1 text-fg truncate px-1 tracking-wide">Fina</h1>
          <div className="flex items-center justify-end shrink-0 min-w-[4.5rem] sm:min-w-[5.5rem]">
            <span className="text-xs border border-subtle bg-surface text-fg-muted px-2 py-1 rounded-control max-w-[5.5rem] truncate hidden sm:inline-block">
              {role}
            </span>
          </div>
        </div>
      </header>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity duration-interaction ease-out overscroll-none touch-manipulation"
          style={{ backgroundColor: 'var(--overlay-scrim)' }}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-dvh min-h-0 w-[var(--sidebar-width-expanded)] max-w-[min(240px,calc(100vw-1rem))] bg-app border-r border-subtle z-50 transform transition-transform duration-200 ease-out flex flex-col pt-[env(safe-area-inset-top,0px)] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-4 border-b border-subtle flex items-center justify-between">
          <span className="text-h2 text-fg tracking-wide">Fina</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-control text-fg-muted hover:text-fg hover:bg-overlay-hover transition-colors duration-interaction ease-out"
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
            const className = `${navItemBase} ${isActive ? navItemActive : navItemInactive}`;

            if (item.to === '/nueva-operacion') {
              return (
                <button key={item.to} type="button" onClick={handleNewOperationClick} className={className}>
                  {item.label}
                </button>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive: active }) => `${navItemBase} ${active ? navItemActive : navItemInactive}`}
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-subtle px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] space-y-3">
          <div className="flex items-center justify-between gap-3 min-h-[44px]">
            <span className="text-sm text-fg-muted">Tema</span>
            <ThemeToggle className="min-h-[44px] min-w-[44px] shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs border border-subtle bg-surface text-fg-muted px-2 py-1 rounded-control truncate">{role}</span>
            <button
              onClick={logout}
              className="min-h-[44px] px-3 inline-flex items-center text-sm text-error hover:text-error/90 font-medium transition-colors duration-interaction ease-out"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      <main className="max-w-[min(100%,var(--content-max-width))] mx-auto w-full min-w-0 flex-1 px-4 pb-6 pt-[calc(env(safe-area-inset-top,0px)+3rem)]">
        <Outlet />
      </main>
    </div>
  );
}
