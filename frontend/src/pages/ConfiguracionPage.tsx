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
        <h2 className="text-xl font-semibold text-gray-800">Configuración</h2>
        {!canEditSettings && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded shrink-0 self-start sm:self-auto">Solo lectura</span>
        )}
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex flex-wrap gap-4 sm:gap-6">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
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
