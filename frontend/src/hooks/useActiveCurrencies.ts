import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface ActiveCurrency {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

/**
 * Divisas activas para formularios de operación.
 * @param catchEmptyOnError si true, ante error de red/API deja lista vacía (p. ej. TraspasoDeudaCC).
 */
export function useActiveCurrencies(catchEmptyOnError = false): ActiveCurrency[] {
  const [currencies, setCurrencies] = useState<ActiveCurrency[]>([]);
  useEffect(() => {
    const p = api.get<ActiveCurrency[]>('/currencies').then((c) => setCurrencies(c.filter((x) => x.active)));
    if (catchEmptyOnError) {
      p.catch(() => setCurrencies([]));
    }
  }, [catchEmptyOnError]);
  return currencies;
}
