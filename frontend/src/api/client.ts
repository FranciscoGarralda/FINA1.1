/**
 * Base del API para fetch.
 * - Sin `VITE_API_BASE` (local): `/api` + proxy Vite → backend :8080.
 * - Producción (front y API en orígenes distintos): definir `VITE_API_BASE` en el build del front.
 *   Debe ser URL absoluta que termina en `/api` (ej. https://TU-API.up.railway.app/api), sin barra final extra.
 * - Paths del cliente son `/login`, `/foo`… → URL final `${API_BASE}${path}`: una sola `/api` en la ruta (no duplicar `/api` en paths).
 */
const API_BASE = (import.meta.env.VITE_API_BASE?.trim() || '/api').replace(/\/$/, '');

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user_id');
    localStorage.removeItem('permissions');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) throw { status: res.status, message: text || `Error ${res.status}` };
    return {} as T;
  }

  if (!res.ok) {
    throw { status: res.status, ...data };
  }

  return data as T;
}

/** Descarga binaria/texto con el mismo token que `api` (CSV, adjuntos). */
export async function downloadAuthenticated(path: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('user_id');
    localStorage.removeItem('permissions');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const text = await res.text();
    let message = text || `Error ${res.status}`;
    try {
      const data = JSON.parse(text) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* usar texto crudo */
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition');
  let filename = fallbackFilename;
  const quoted = cd?.match(/filename="([^"]+)"/i);
  const star = cd?.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (quoted?.[1]) filename = quoted[1];
  else if (star?.[1]) filename = decodeURIComponent(star[1]);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
