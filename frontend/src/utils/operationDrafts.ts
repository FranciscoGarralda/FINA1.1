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
}

export async function loadOperationDraft<TData>(
  movementId: string,
  operationType: string,
): Promise<TData | null> {
  try {
    const result = await api.get<OperationDraftResponse>(`/movements/${movementId}/draft`);
    const payload = result?.payload as OperationDraftEnvelope<TData> | undefined;
    if (!payload || payload.operation_type !== operationType || !payload.data) return null;
    return payload.data;
  } catch {
    return null;
  }
}
