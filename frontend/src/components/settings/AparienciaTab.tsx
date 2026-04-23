import ThemeToggle from '../common/ThemeToggle';

export default function AparienciaTab() {
  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-fg-muted">
        El tema se guarda en este navegador. No afecta a otros usuarios ni a la configuración del servidor.
      </p>
      <div className="flex items-center justify-between gap-3 min-h-[44px] rounded-control border border-subtle bg-surface px-4 py-3">
        <span className="text-sm font-medium text-fg">Tema</span>
        <ThemeToggle className="min-h-[44px] min-w-[44px] shrink-0" />
      </div>
    </div>
  );
}
