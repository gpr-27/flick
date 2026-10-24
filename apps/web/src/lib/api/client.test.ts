import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApiClient, ignoreBody } from './client';
import { ApiError, INVALID_RESPONSE, NETWORK_ERROR } from './errors';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const userSchema = z.object({ id: z.string() });
const parseUser = (d: unknown) => userSchema.parse(d);

const authHeader = (init: RequestInit | undefined): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

const auth = { getToken: () => Promise.resolve('t1'), getDeviceId: () => 'device-1' };

describe('createApiClient', () => {
  it('sends JSON with the bearer token and parses the typed response', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(json(200, { id: 'u1' })),
    );
    const api = createApiClient({
      baseUrl: 'http://x/api/',
      ...auth,
      fetch,
      headers: { 'X-T': '1' },
    });

    await expect(
      api.post('/users', { name: 'a' }, parseUser, { query: { q: 'z', skip: undefined } }),
    ).resolves.toEqual({ id: 'u1' });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://x/api/users?q=z');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ name: 'a' }));
    expect(init?.credentials).toBe('omit');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer t1',
      'Content-Type': 'application/json',
      'X-T': '1',
    });
  });

  it('attaches X-Device-Id and signs out (onUnauthorized) on a 401, without retrying', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(json(401, { error: { code: 'UNAUTHORIZED', message: 'nope' } })),
    );
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'http://x', ...auth, fetch, onUnauthorized });

    await expect(api.get('/me', parseUser)).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ 'X-Device-Id': 'device-1' });
  });

  it('skips auth entirely when auth: false', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(json(401, {})),
    );
    const api = createApiClient({ baseUrl: 'http://x', ...auth, fetch });

    await expect(api.get('/public', parseUser, { auth: false })).rejects.toMatchObject({
      status: 401,
    });
    expect(authHeader(fetch.mock.calls[0]![1])).toBeUndefined();
  });

  it('maps network failures to a retryable NETWORK_ERROR', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      ...auth,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const error = await api.get('/me', parseUser).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0, code: NETWORK_ERROR, retryable: true });
  });

  it('reads the contract error body, including its retryable flag', async () => {
    const body = (retryable: boolean) => ({
      error: { code: 'RATE_LIMITED', message: 'Slow down.', retryable },
    });
    for (const retryable of [true, false]) {
      const api = createApiClient({
        baseUrl: 'http://x',
        ...auth,
        fetch: () => Promise.resolve(json(400, body(retryable))),
      });
      await expect(api.get('/m', parseUser)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        message: 'Slow down.',
        status: 400,
        retryable,
      });
    }
  });

  it('falls back to a generic error for bodies that are not the contract shape', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      ...auth,
      fetch: () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })),
    });
    await expect(api.get('/m', parseUser)).rejects.toMatchObject({
      code: 'HTTP_502',
      status: 502,
      retryable: true,
    });
  });

  it('flags 5xx and 429 as retryable', async () => {
    for (const status of [429, 500, 503]) {
      const api = createApiClient({
        baseUrl: 'http://x',
        ...auth,
        fetch: () => Promise.resolve(json(status, {})),
      });
      await expect(api.get('/m', parseUser)).rejects.toMatchObject({ retryable: true });
    }
  });

  it('rejects responses that fail validation', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      ...auth,
      fetch: () => Promise.resolve(json(200, { nope: 1 })),
    });
    await expect(api.get('/m', parseUser)).rejects.toMatchObject({ code: INVALID_RESPONSE });
  });

  it('handles empty bodies', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      ...auth,
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
    });
    await expect(api.delete('/m/1', ignoreBody)).resolves.toBeUndefined();
  });

  it('calls onError for observability', async () => {
    const onError = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://x',
      ...auth,
      fetch: () => Promise.resolve(json(500, {})),
      onError,
    });
    await api.get('/m', parseUser).catch(() => undefined);
    expect(onError).toHaveBeenCalledWith(expect.any(ApiError), { method: 'GET', path: '/m' });
  });
});
