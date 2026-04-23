import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SeguridadTab from '../components/settings/SeguridadTab';
import EstadosTab from '../components/settings/EstadosTab';
import PoliticasTab from '../components/settings/PoliticasTab';
import PermisosTab from '../components/settings/PermisosTab';
import AparienciaTab from '../components/settings/AparienciaTab';

const TABS_VIEW = ['Seguridad', 'Estados', 'Políticas'] as const;
const TABS_EDIT = ['Seguridad', 'Estados', 'Políticas', 'Permisos'] as const;

type SystemTab = (typeof TABS_EDIT)[number];
type TabName = 'Apariencia' | SystemTab;

export default function ConfiguracionPage() {
  const { can } = useAuth();
  const canViewSettings = can('settings.view');
  const canEditSettings = can('settings.edit');

  const visibleTabs = useMemo((): TabName[] => {
    const tabs: TabName[] = ['Apariencia'];
    if (!canViewSettings) return tabs;
    if (canEditSettings) return [...tabs, ...TABS_EDIT];
    return [...tabs, ...TABS_VIEW];
  }, [canViewSettings, canEditSettings]);

  const [activeTab, setActiveTab] = useState<TabName>(() => (canViewSettings ? 'Seguridad' : 'Apariencia'));

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab((visibleTabs[1] ?? visibleTabs[0]) as TabName);
    }
  }, [visibleTabs, activeTab]);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-fg">Configuración</h2>
        {canViewSettings && !canEditSettings && (
          <span className="text-xs bg-warning-soft text-warning px-2 py-1 rounded shrink-0 self-start sm:self-auto">Solo lectura</span>
        )}
      </div>

      <div className="border-b border-subtle mb-6">
        <nav className="flex flex-wrap gap-4 sm:gap-6">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-brand text-info'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'Apariencia' && <AparienciaTab />}
      {canViewSettings && activeTab === 'Seguridad' && <SeguridadTab />}
      {canViewSettings && activeTab === 'Estados' && <EstadosTab />}
      {canViewSettings && activeTab === 'Políticas' && <PoliticasTab />}
      {canViewSettings && canEditSettings && activeTab === 'Permisos' && <PermisosTab />}
    </div>
  );
}
