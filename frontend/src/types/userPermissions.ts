/** GET /api/users/{id}/permissions — alineado con UserPermissionMatrixItem (backend). */

export type UserPermissionSource = 'USER' | 'ROLE' | 'FALLBACK';

export interface UserPermissionMatrixItem {
  key: string;
  module: string;
  label: string;
  description?: string | null;
  source: UserPermissionSource;
  allowed: boolean;
}

export interface UserPermissionsResponse {
  user_id: string;
  role: string;
  items: UserPermissionMatrixItem[];
}
