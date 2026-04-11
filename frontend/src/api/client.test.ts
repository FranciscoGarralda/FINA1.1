import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, downloadAuthenticated } from './client';

function jsonResponse(status: number, body: string): Response {
  const ok = status >= 200 && status < 300;
  return {
    status,
    ok,
    text: () => Promise.resolve(body),
    headers: new Headers(),
    blob: () => Promise.resolve(new Blob()),
  } as Response;
}

/** En DEV el cliente puede hacer un segundo fetch al ingest de debug; lo absorbemos. */
function setupFetch(impl: (url: string) => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('127.0.0.1:7846')) {
        return Promise.resolve(jsonResponse(204, ''));
      }
      return impl(url);
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('api client', () => {
  it('get returns parsed JSON on 200', async () => {
    setupFetch((url) => {
      expect(url).toContain('/api/items');
      return Promise.resolve(jsonResponse(200, '{"x":1}'));
    });
    const r = await api.get<{ x: number }>('/items');
    expect(r).toEqual({ x: 1 });
  });

  it('401 dispatches auth:session-expired and throws', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    setupFetch(() => Promise.resolve(jsonResponse(401, '')));
    await expect(api.get('/protected')).rejects.toThrow('Unauthorized');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth:session-expired' }));
  });

  it('403 with JSON body throws merged error object', async () => {
    setupFetch(() =>
      Promise.resolve(jsonResponse(403, '{"error":"FORBIDDEN","message":"no"}')),
    );
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 403,
      error: 'FORBIDDEN',
    });
  });

  it('post sends JSON body', async () => {
    setupFetch((url) => {
      expect(url).toContain('/api/login');
      return Promise.resolve(jsonResponse(200, '{"token":"t","role":"ADMIN","user_id":"1"}'));
    });
    await api.post('/login', { username: 'a', password: 'b' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'a', password: 'b' }),
      }),
    );
  });

  it('downloadAuthenticated on 401 dispatches session-expired and throws', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    setupFetch(() => Promise.resolve(jsonResponse(401, '')));
    await expect(downloadAuthenticated('/cc/export', 'x.csv')).rejects.toThrow('Unauthorized');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth:session-expired' }));
  });
});
