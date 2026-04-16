type EmptyStateProps = {
  message: string;
  /** Título corto opcional encima del mensaje. */
  title?: string;
  /**
   * `card`: bloque con borde punteado (listas / páginas).
   * `inline`: sin borde extra; para usar dentro de contenedores ya delimitados (tablas, modales).
   */
  variant?: 'card' | 'inline';
  className?: string;
};

function EmptyIcon() {
  return (
    <span
      className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-subtle text-fg-muted"
      aria-hidden
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <path d="M2 10h20" />
      </svg>
    </span>
  );
}

export function EmptyState({ message, title, variant = 'card', className = '' }: EmptyStateProps) {
  const shell =
    variant === 'inline'
      ? `text-center ${className}`
      : `rounded-lg border border-dashed border-subtle bg-surface/40 px-4 py-6 text-center ${className}`;

  return (
    <div role="status" className={shell}>
      <EmptyIcon />
      {title ? <p className="text-sm font-medium text-fg mb-1">{title}</p> : null}
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
