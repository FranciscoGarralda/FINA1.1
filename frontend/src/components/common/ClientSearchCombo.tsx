import { useCallback, useEffect, useRef, useState } from 'react';

export interface ClientSearchComboItem {
  id: string;
  client_code: number;
  first_name: string;
  last_name: string;
  cc_enabled?: boolean;
}

function clientDisplayLabel(c: ClientSearchComboItem): string {
  const cc = c.cc_enabled ? ' [CC]' : '';
  return `#${c.client_code} — ${c.last_name}, ${c.first_name}${cc}`;
}

interface ClientSearchComboProps {
  clients: ClientSearchComboItem[];
  value: string;
  onChange: (clientId: string) => void;
  loading?: boolean;
  /** Filtra filas antes del texto de búsqueda (ej. solo clientes con CC). */
  listFilter?: (c: ClientSearchComboItem) => boolean;
  disabled?: boolean;
  inputId?: string;
  /** Clases del contenedor relativo (default ancho completo). */
  className?: string;
}

export default function ClientSearchCombo({
  clients,
  value,
  onChange,
  loading = false,
  listFilter,
  disabled = false,
  inputId,
  className = 'relative w-full max-w-sm',
}: ClientSearchComboProps) {
  const comboRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const baseList = listFilter ? clients.filter(listFilter) : clients;

  const filtered = baseList.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.first_name.toLowerCase().includes(q) ||
      c.last_name.toLowerCase().includes(q) ||
      String(c.client_code).includes(q)
    );
  });

  const selectClient = useCallback(
    (c: ClientSearchComboItem) => {
      onChange(c.id);
      setQuery(clientDisplayLabel(c));
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const clearClient = useCallback(() => {
    onChange('');
    setQuery('');
    setActiveIndex(-1);
  }, [onChange]);

  useEffect(() => {
    if (!value) {
      setQuery('');
      return;
    }
    const found = clients.find((c) => c.id === value);
    if (found) setQuery(clientDisplayLabel(found));
  }, [value, clients]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
        if (value) {
          const found = clients.find((c) => c.id === value);
          if (found) setQuery(clientDisplayLabel(found));
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value, clients]);

  function handleComboKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        selectClient(filtered[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  if (loading) {
    return <p className="text-sm text-fg-muted">Cargando clientes...</p>;
  }

  return (
    <div ref={comboRef} className={className}>
      <div className="flex">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          placeholder="Buscar por nombre o código…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange('');
            setIsOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => !disabled && setIsOpen(true)}
          onKeyDown={handleComboKeyDown}
          className="input-field"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => {
              clearClient();
              inputRef.current?.focus();
            }}
            className="ml-1 px-2 text-fg-subtle hover:text-fg-muted text-lg"
            title="Limpiar"
          >
            &times;
          </button>
        )}
      </div>
      {isOpen && !disabled && (
        <div className="absolute z-[60] mt-1 w-full bg-elevated border border-subtle rounded shadow-lg max-h-64 overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-fg-subtle">Sin resultados</div>
          ) : (
            filtered.map((c, idx) => (
              <div
                key={c.id}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  selectClient(c);
                }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  idx === activeIndex
                    ? 'bg-brand text-white'
                    : c.id === value
                      ? 'bg-brand-soft text-brand'
                      : 'text-fg hover:bg-surface'
                }`}
              >
                {clientDisplayLabel(c)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
