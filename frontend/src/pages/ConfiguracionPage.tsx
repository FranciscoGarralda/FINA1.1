import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import SeguridadTab from '../components/settings/SeguridadTab';
import EstadosTab from '../components/settings/EstadosTab';
import PoliticasTab from '../components/settings/PoliticasTab';

const TABS = ['Seguridad', 'Estados', 'Políticas'] as const;
type TabName = (typeof TABS)[number];

export default function ConfiguracionPage() {
  const [activeTab, setActiveTab] = useState<TabName>('Seguridad');
  const { can } = useAuth();
  const canEditSettings = can('settings.edit');

  const visibleTabs = TABS;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6 min-w-0">
        <h2 className="text-xl font-semibold text-fg">Configuración</h2>
        {!canEditSettings && (
          <span className="text-xs bg-warning-soft text-warning px-2 py-1 rounded shrink-0 self-start sm:self-auto">Solo lectura</span>
        )}
      </div>

      <div className="border-b border-subtle mb-6">
        <nav className="flex flex-wrap gap-4 sm:gap-6">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
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

      {activeTab === 'Seguridad' && <SeguridadTab />}
      {activeTab === 'Estados' && <EstadosTab />}
      {activeTab === 'Políticas' && <PoliticasTab />}
    </div>
  );
}
