import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface ActiveAccount {
  id: string;
  name: string;
  active: boolean;
}

/** Cuentas activas para formularios de operación (mismo filtro que antes: `active === true`). */
export function useActiveAccounts(): ActiveAccount[] {
  const [accounts, setAccounts] = useState<ActiveAccount[]>([]);
  useEffect(() => {
    api.get<ActiveAccount[]>('/accounts').then((a) => setAccounts(a.filter((x) => x.active)));
  }, []);
  return accounts;
}
