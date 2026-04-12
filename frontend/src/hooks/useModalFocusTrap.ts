import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    return true;
  });
}

function focusFirstIn(container: HTMLElement): void {
  const els = getFocusableElements(container);
  if (els.length > 0) {
    els[0].focus();
    return;
  }
  const panel = container.querySelector<HTMLElement>('.modal-panel');
  if (panel) {
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
    panel.focus();
  }
}

/**
 * Trap de foco + Escape para modales en portal.
 * Restaura el foco al elemento activo al abrir cuando el modal se desmonta.
 * No registrar listeners globales de flechas: solo Tab y Escape en fase capture si el foco está dentro del contenedor.
 */
export function useModalFocusTrap(options: {
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  active?: boolean;
  /** Al cambiar (ej. loading → listo), reintenta enfocar el primer control */
  refocusToken?: unknown;
}): void {
  const { containerRef, onClose, active = true, refocusToken } = options;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const openingFocusRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!active) return;
    openingFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as Node | null;
      if (!t || !container.contains(t)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== 'Tab') return;

      const els = getFocusableElements(container);
      if (els.length === 0) {
        e.preventDefault();
        const panel = container.querySelector<HTMLElement>('.modal-panel');
        const fallback = panel ?? container;
        if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
        fallback.focus();
        return;
      }

      const ae = document.activeElement as HTMLElement | null;
      if (!ae || !container.contains(ae)) return;

      const idx = els.indexOf(ae);
      if (idx < 0) return;

      if (e.shiftKey) {
        if (idx === 0) {
          e.preventDefault();
          els[els.length - 1].focus();
        }
      } else if (idx === els.length - 1) {
        e.preventDefault();
        els[0].focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const prev = openingFocusRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [active, containerRef]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const id = requestAnimationFrame(() => focusFirstIn(container));
    return () => cancelAnimationFrame(id);
  }, [active, containerRef, refocusToken]);
}
