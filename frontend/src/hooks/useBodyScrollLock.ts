import { useEffect } from 'react';

const LOCK_CLASS = 'modal-scroll-locked';

/**
 * Bloquea scroll del body mientras un modal está abierto (lista blanca v7).
 * Sin lógica de negocio: solo efecto de presentación.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    document.body.classList.add(LOCK_CLASS);
    return () => {
      document.body.classList.remove(LOCK_CLASS);
    };
  }, [active]);
}
