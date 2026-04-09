import { api } from '../api/client';

export interface OperationDraftEnvelope<TData> {
  schema_version: number;
  operation_type: string;
  data: TData;
}

interface OperationDraftResponse {
  movement_id: string;
  payload: OperationDraftEnvelope<unknown>;
  updated_at: string;
}

const DRAFT_SCHEMA_VERSION = 1;

/** Prefijo de sessionStorage: un movimiento puede tener un solo tipo; la clave incluye el tipo. */
const CACHE_PREFIX = 'fina:op-draft-cache:';

function cacheKey(movementId: string, operationType: string): string {
  return `${CACHE_PREFIX}${movementId}:${operationType}`;
}

/**
 * Elimina la caché local del borrador (p. ej. tras descartar, resetear wizard o limpiar payload en servidor).
 * Sin operationType, borra todas las entradas del movementId.
 */
export function clearOperationDraftCache(movementId: string, operationType?: string): void {
  try {
    if (operationType) {
      sessionStorage.removeItem(cacheKey(movementId, operationType));
      return;
    }
    const prefix = `${CACHE_PREFIX}${movementId}:`;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    // sessionStorage puede fallar en modo privado / cuota; no bloquear flujo.
  }
}

function parseEnvelopeFromResponse(result: unknown): OperationDraftEnvelope<unknown> | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  let payload: unknown = r.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== 'object') return null;
  const env = payload as Record<string, unknown>;
  const op = env.operation_type;
  const data = env.data;
  if (typeof op !== 'string' || data === undefined || data === null) return null;
  return {
    schema_version: typeof env.schema_version === 'number' ? env.schema_version : DRAFT_SCHEMA_VERSION,
    operation_type: op,
    data,
  };
}

function persistCache<TData>(movementId: string, operationType: string, data: TData): void {
  try {
    sessionStorage.setItem(cacheKey(movementId, operationType), JSON.stringify(data));
  } catch {
    // no bloquear
  }
}

export async function saveOperationDraft<TData>(
  movementId: string,
  operationType: string,
  data: TData,
): Promise<void> {
  const payload: OperationDraftEnvelope<TData> = {
    schema_version: DRAFT_SCHEMA_VERSION,
    operation_type: operationType,
    data,
  };
  await api.put(`/movements/${movementId}/draft`, payload);
  persistCache(movementId, operationType, data);
}

export async function loadOperationDraft<TData>(
  movementId: string,
  operationType: string,
): Promise<TData | null> {
  const mapEnvelope = (result: unknown): TData | null => {
    const env = parseEnvelopeFromResponse(result);
    if (!env || env.operation_type !== operationType) return null;
    return env.data as TData;
  };

  const tryServer = async (): Promise<TData | null> => {
    try {
      const result = await api.get<OperationDraftResponse>(`/movements/${movementId}/draft`);
      const data = mapEnvelope(result);
      if (data !== null) {
        persistCache(movementId, operationType, data);
      }
      return data;
    } catch {
      return null;
    }
  };

  let data = await tryServer();
  if (data === null) {
    await new Promise((r) => setTimeout(r, 250));
    data = await tryServer();
  }
  if (data !== null) return data;

  try {
    const raw = sessionStorage.getItem(cacheKey(movementId, operationType));
    if (!raw) return null;
    return JSON.parse(raw) as TData;
  } catch {
    return null;
  }
}
