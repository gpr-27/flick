/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- test payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { ENDPOINTS, ErrorBody, ErrorResponse, buildPath, type Endpoint } from '@chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { createAuth, createClerk, type Auth, type Clerk } from '../../src/modules/auth/index.js';
import { createFakeClerk } from '../../src/modules/auth/fake-clerk.js';
import { createDatabase, group, startStack, type Stack, type TestDatabase } from './harness.js';

// RATE LIMITING, SECURITY HEADERS, CORS, LOGIN.

class FakeProvider implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  complete(_p: ProviderCallParams): Promise<string> {
    return Promise.resolve('fake answer');
  }
  async *stream(p: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(p);
  }
}

let database: TestDatabase;
beforeAll(async () => {
  database = await createDatabase('sec');
});
afterAll(async () => {
  await database.drop();
});

/** Each test uses its own client address, so the limits (kept in Redis) never leak between tests. */
const ip = () =>
  `198.51.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250) + 1)}`;

function expectRateLimited(
  res: { status: number; body: any; headers: Record<string, any> },
  what: string,
) {
  expect(res.status, `${what}: ${JSON.stringify(res.body)}`).toBe(429);
  const parsed = ErrorResponse.safeParse(res.body);
  expect(parsed.success, `${what}: ${JSON.stringify(res.body)}`).toBe(true);
  expect(res.body.error.code).toBe('RATE_LIMITED');
  expect(res.body.error.retryable).toBe(true);
  expect(res.headers['retry-after'], `${what}: retry-after`).toBeDefined();
}

describe('the global per-IP limit', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack({
      databaseUrl: database.url,
      env: { RATE_LIMIT_MAX: '8', TRUST_PROXY: 'true' },
    });
  });
  afterAll(async () => {
    await stack.stop();
  });

  it('lets 8 requests a minute through and answers the 9th with 429 in the standard error shape', async () => {
    const user = await stack.user('limited');
    const client = ip();
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof stack.call>> | undefined;
    for (let i = 0; i < 10; i++) {
      last = await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
    expectRateLimited(last!, 'the 10th request');
    expect(last!.headers['x-ratelimit-limit']).toBe('8');
    expect(last!.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('counts per client address: another address is not affected', async () => {
    const user = await stack.user('limited');
    const a = ip();
    const b = ip();
    for (let i = 0; i < 9; i++)
      await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': a });
    expect(
      (await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': a })).status,
    ).toBe(429);
    expect(
      (await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': b })).status,
    ).toBe(200);
  });

  it('applies to requests that fail too, and to unknown URLs (so scanning is throttled)', async () => {
    const client = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await stack.call(null, 'GET', `/wp-admin/${String(i)}.php`, undefined, {
        'x-forwarded-for': client,
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(404));
    expect(statuses.slice(8)).toEqual([429, 429]);
    const unauth = ip();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push(
        (await stack.call(null, 'GET', '/users/me', undefined, { 'x-forwarded-for': unauth }))
          .status,
      );
    }
    expect(codes.slice(0, 8)).toEqual(Array(8).fill(401));
    expect(codes.slice(8)).toEqual([429, 429]);
  });

  it('never limits health checks or metrics, however many arrive', async () => {
    const client = ip();
    for (let i = 0; i < 30; i++) {
      const live = await stack.call(null, 'GET', '/health/live', undefined, {
        'x-forwarded-for': client,
      });
      expect(live.status).toBe(200);
    }
    for (let i = 0; i < 12; i++) {
      expect(
        (await stack.call(null, 'GET', '/metrics', undefined, { 'x-forwarded-for': client }))
          .status,
      ).toBe(200);
    }
  });

  it('is shared by API replicas (the counter is in Redis): 4 requests on one and 4 on another use up the same 8', async () => {
    const second = await startStack({
      databaseUrl: database.url,
      env: { RATE_LIMIT_MAX: '8', TRUST_PROXY: 'true' },
    });
    try {
      const user = await stack.user('shared');
      const client = ip();
      for (let i = 0; i < 4; i++) {
        expect(
          (await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client }))
            .status,
        ).toBe(200);
        expect(
          (await second.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client }))
            .status,
        ).toBe(200);
      }
      expectRateLimited(
        await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client }),
        'replica A',
      );
      expectRateLimited(
        await second.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client }),
        'replica B',
      );
    } finally {
      await second.stop();
    }
  });

  it('the window is one minute: the counter in Redis expires', async () => {
    const user = await stack.user('ttl');
    const client = ip();
    await stack.call(user, 'GET', '/users/me', undefined, { 'x-forwarded-for': client });
    const keys = await stack.redis.keys(`*${client}*`);
    expect(keys.length).toBeGreaterThan(0);
    const ttl = await stack.redis.pttl(keys[0]!);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });
});

describe('limits on single routes', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack({
      databaseUrl: database.url,
      env: {
        TRUST_PROXY: 'true',
        LIVEKIT_URL: 'wss://livekit.example.test',
        LIVEKIT_API_KEY: 'devkey',
        LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret-12345',
      },
      ai: aiServiceFromChain(new AiChain({ adapters: [new FakeProvider()] })),
    });
  });
  afterAll(async () => {
    await stack.stop();
  });

  it('call-link lookups are limited to 20 a minute per client (guessing codes)', async () => {
    const user = await stack.user('guesser');
    const client = ip();
    const results: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await stack.call(user, 'GET', '/calls/links/AAAAAAAAAAAAAAAAAAAA', undefined, {
        'x-forwarded-for': client,
      });
      results.push(res.status);
      if (i === 21) expectRateLimited(res, 'link lookup 22');
    }
    expect(results.slice(0, 20)).toEqual(Array(20).fill(404));
    expect(results.slice(20)).toEqual([429, 429]);
  });

  it('LiveKit tokens share the same 20 a minute', async () => {
    const [owner] = [await stack.user('owner')];
    const conv = await group(stack, owner, [await stack.user('m')]);
    const client = ip();
    let limitedAt = -1;
    for (let i = 0; i < 24; i++) {
      const res = await stack.call(
        owner,
        'POST',
        '/calls/livekit-token',
        { conversation_id: conv, media: 'audio' },
        { 'x-forwarded-for': client },
      );
      if (res.status === 429) {
        limitedAt = i;
        expectRateLimited(res, 'livekit');
        break;
      }
      expect(res.status).toBe(200);
    }
    expect(limitedAt).toBe(20);
  });

  it('upload URLs are limited to 60 a minute per client', async () => {
    const user = await stack.user('uploader');
    const client = ip();
    let limitedAt = -1;
    for (let i = 0; i < 64; i++) {
      const res = await stack.call(
        user,
        'POST',
        '/media/presign',
        { purpose: 'message', mime: 'image/png', size: 100 },
        { 'x-forwarded-for': client },
      );
      if (res.status === 429) {
        limitedAt = i;
        expectRateLimited(res, 'presign');
        break;
      }
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(limitedAt).toBe(60);
  });

  it('AI requests are limited to 20 a minute per user (not per IP)', async () => {
    const user = await stack.user('asker');
    const other = await stack.user('other');
    let limitedAt = -1;
    for (let i = 0; i < 24; i++) {
      const res = await stack.call(
        user,
        'POST',
        '/ai/translate',
        { text: 'hello', targetLang: 'fr' },
        { accept: 'application/json', 'x-forwarded-for': ip() },
      );
      if (res.status === 429) {
        limitedAt = i;
        expectRateLimited(res, 'ai');
        break;
      }
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    expect(limitedAt).toBe(20);
    // another user, same machine, is not affected
    const fine = await stack.call(
      other,
      'POST',
      '/ai/translate',
      { text: 'hello', targetLang: 'fr' },
      { accept: 'application/json', 'x-forwarded-for': ip() },
    );
    expect(fine.status).toBe(200);
  });

  it('link previews are limited to 30 a minute per user', async () => {
    const user = await stack.user('previewer');
    let limitedAt = -1;
    for (let i = 0; i < 34; i++) {
      const res = await stack.call(
        user,
        'GET',
        `/link-preview?url=${encodeURIComponent('http://127.0.0.1:1/x')}`,
        undefined,
        { 'x-forwarded-for': ip() },
      );
      if (res.status === 429) {
        limitedAt = i;
        expectRateLimited(res, 'link preview');
        break;
      }
    }
    expect(limitedAt).toBe(30);
  });

  it('a socket that floods events is told RATE_LIMITED in the standard error shape, and recovers', async () => {
    const user = await stack.user('flooder');
    const client = await stack.connect(user);
    const acks = await Promise.all(
      Array.from({ length: 120 }, () => client.emit('sync_request', { cursors: [], limit: 1 })),
    );
    const limited = acks.filter((a) => a.ok === false);
    expect(limited.length).toBeGreaterThan(0);
    expect(acks.filter((a) => a.ok === true).length).toBeGreaterThanOrEqual(40);
    for (const a of limited) {
      expect(ErrorBody.safeParse(a.error).success).toBe(true);
      expect(a.error.code).toBe('RATE_LIMITED');
    }
    await new Promise((r) => setTimeout(r, 1500)); // the bucket refills 20 a second
    const again = await client.emit('sync_request', { cursors: [], limit: 1 });
    expect(again.ok).toBe(true);
  });
});

describe('security headers', () => {
  let stack: Stack;
  beforeAll(async () => {
    stack = await startStack({ databaseUrl: database.url });
  });
  afterAll(async () => {
    await stack.stop();
  });

  const expectedHeaders = (headers: Record<string, any>, what: string) => {
    expect(headers['x-content-type-options'], what).toBe('nosniff');
    expect(headers['x-frame-options'], what).toBe('SAMEORIGIN');
    expect(headers['strict-transport-security'], what).toMatch(/max-age=\d+/);
    expect(headers['x-dns-prefetch-control'], what).toBe('off');
    expect(headers['referrer-policy'], what).toBe('no-referrer');
    expect(headers['cross-origin-opener-policy'], what).toBe('same-origin');
    expect(headers['cross-origin-resource-policy'], what).toBe('same-origin');
    expect(headers['content-security-policy'], what).toContain("default-src 'self'");
    expect(headers['x-permitted-cross-domain-policies'], what).toBe('none');
    expect(headers['x-download-options'], what).toBe('noopen');
    expect(headers['x-powered-by'], `${what}: must not advertise the framework`).toBeUndefined();
    expect(headers.server, `${what}: must not advertise the server`).toBeUndefined();
  };

  it('are on a normal answer, on errors and on unknown routes', async () => {
    const user = await stack.user('h');
    const conv = await group(stack, user, [await stack.user('m')]);
    const ok = await stack.call(user, 'GET', '/users/me');
    expectedHeaders(ok.headers, '200 JSON');
    expectedHeaders((await stack.call(null, 'GET', '/health/live')).headers, 'health');
    expectedHeaders((await stack.call(user, 'GET', '/users/not-a-uuid')).headers, '400');
    expectedHeaders((await stack.call(null, 'GET', '/users/me')).headers, '401');
    expectedHeaders(
      (await stack.call(user, 'GET', `/conversations/${randomUUID()}`)).headers,
      '404',
    );
    expectedHeaders((await stack.call(user, 'GET', '/no/such/route')).headers, 'unknown route');
    expectedHeaders(
      (await stack.call(user, 'POST', `/conversations/${conv}/messages`, { nonsense: true }))
        .headers,
      'validation error',
    );
    expectedHeaders(
      (await stack.call(user, 'DELETE', `/conversations/${conv}/members/${user.id}`)).headers,
      '204/4xx',
    );
  });

  it('API answers are JSON and are never sniffed as something else', async () => {
    const user = await stack.user('j');
    const res = await stack.call(user, 'GET', '/users/me');
    expect(String(res.headers['content-type'])).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS', () => {
  let stack: Stack;
  const ORIGIN = 'https://flick.example.test';
  const OTHER = 'https://second.example.test';
  beforeAll(async () => {
    stack = await startStack({
      databaseUrl: database.url,
      env: { CORS_ORIGINS: `${ORIGIN},${OTHER}` },
    });
  });
  afterAll(async () => {
    await stack.stop();
  });

  const preflight = (
    method: string,
    origin: string,
    headers = 'authorization,content-type,x-device-id',
  ) =>
    stack.call(null, 'OPTIONS', '/conversations', undefined, {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': headers,
    });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'a preflight for %s from the web app is allowed, with credentials and the headers the app sends',
    async (method) => {
      const res = await preflight(method, ORIGIN);
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      const methods = String(res.headers['access-control-allow-methods'])
        .split(',')
        .map((m) => m.trim());
      expect(methods).toContain(method);
      const allowed = String(res.headers['access-control-allow-headers']).toLowerCase();
      for (const h of ['authorization', 'content-type', 'x-device-id'])
        expect(allowed).toContain(h);
      expect(String(res.headers.vary).toLowerCase()).toContain('origin');
    },
  );

  it('the allowed methods are exactly the ones the API uses (no TRACE, CONNECT)', async () => {
    const res = await preflight('GET', ORIGIN);
    const methods = String(res.headers['access-control-allow-methods'])
      .split(',')
      .map((m) => m.trim())
      .sort();
    expect(methods).toEqual(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']);
  });

  it('every method the contract uses is covered by the preflight answer', async () => {
    const used = new Set(
      Object.values(ENDPOINTS).flatMap((g) =>
        Object.values(g as Record<string, Endpoint>).map((e) => e.method),
      ),
    );
    const res = await preflight('GET', ORIGIN);
    const methods = String(res.headers['access-control-allow-methods']);
    for (const m of used) expect(methods, `the contract uses ${m}`).toContain(m);
  });

  it('both configured origins are allowed, each answered with itself (never a wildcard)', async () => {
    for (const origin of [ORIGIN, OTHER]) {
      const res = await preflight('POST', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it.each([
    ['another site', 'https://evil.example.test'],
    ['the same site over http', 'http://flick.example.test'],
    ['a sub-domain', 'https://app.flick.example.test'],
    ['the origin with a trailing slash', `${ORIGIN}/`],
    ['null (sandboxed pages and files)', 'null'],
    ['a different port', 'https://flick.example.test:8443'],
  ])('a preflight from %s gets no permission', async (_name, origin) => {
    const res = await preflight('POST', origin);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // (an allow-credentials header on its own is inert: without allow-origin the browser refuses the answer)
  });

  it('a real request from the web app carries the allow headers; one from a stranger does not', async () => {
    const user = await stack.user('cors');
    const ok = await stack.call(user, 'GET', '/users/me', undefined, { origin: ORIGIN });
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await stack.call(user, 'GET', '/users/me', undefined, {
      origin: 'https://evil.example.test',
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('errors carry the allow headers too, so the web app can read them', async () => {
    const res = await stack.call(null, 'GET', '/users/me', undefined, { origin: ORIGIN });
    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('a 429 carries them as well', async () => {
    const limited = await startStack({
      databaseUrl: database.url,
      env: { CORS_ORIGINS: ORIGIN, RATE_LIMIT_MAX: '2', TRUST_PROXY: 'true' },
    });
    try {
      const client = ip();
      const hit = () =>
        limited.call(null, 'GET', '/users/me', undefined, {
          origin: ORIGIN,
          'x-forwarded-for': client,
        });
      await hit();
      await hit();
      const res = await hit();
      expect(res.status).toBe(429);
      expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    } finally {
      await limited.stop();
    }
  });
});

describe('login (the real authenticate, with a fake Clerk)', () => {
  let stack: Stack;
  let auth: Auth;
  const clerk: Clerk = createFakeClerk();

  beforeAll(async () => {
    // the stack needs `authenticate` before its database exists, so it calls through a variable
    stack = await startStack({
      databaseUrl: database.url,
      spreadIps: true,
      authenticate: (req, reply) => auth.authenticate(req, reply),
    });
    auth = createAuth({ db: stack.db, redis: stack.redis, clerk });
  });
  afterAll(async () => {
    await stack.stop();
  });

  const flat = Object.entries(ENDPOINTS).flatMap(([g, defs]) =>
    Object.entries(defs as Record<string, Endpoint>).map(([name, def]) => ({
      key: `${g}.${name}`,
      def,
    })),
  );
  const urlOf = (def: Endpoint) =>
    buildPath('', def.path, {
      conversation_id: randomUUID(),
      message_id: randomUUID(),
      user_id: randomUUID(),
      request_id: randomUUID(),
      attachment_id: randomUUID(),
      device_id: randomUUID(),
      scheduled_id: randomUUID(),
      reminder_id: randomUUID(),
      username: 'someone',
      code: 'AAAAAAAAAAAAAAAAAAAA',
    });

  it.each(flat.filter((e) => e.def.auth).map((e) => [e.key, e.def] as const))(
    '%s without a token is 401 UNAUTHORIZED in the standard shape',
    async (key, def) => {
      const res = await stack.call(null, def.method, urlOf(def), def.body ? {} : undefined, {
        'x-device-id': randomUUID(),
      });
      expect(res.status, key).toBe(401);
      expect(ErrorResponse.safeParse(res.body).success, `${key}: ${JSON.stringify(res.body)}`).toBe(
        true,
      );
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    },
  );

  // Public endpoints have no login. calls.declineFromPush is proven by a one-time token that came
  // inside the push; without it, or with a wrong one, nothing happens and nobody learns whether
  // the call exists.
  describe.each(flat.filter((e) => !e.def.auth).map((e) => [e.key, e.def] as const))(
    '%s (public, token-based)',
    (_key, def) => {
      const post = (body: unknown, headers: Record<string, string> = {}) =>
        stack.call(null, def.method, urlOf(def), body, headers);
      const expectStandard = (res: Awaited<ReturnType<typeof post>>, status: number) => {
        expect(res.status, JSON.stringify(res.body)).toBe(status);
        expect(ErrorResponse.safeParse(res.body).success, JSON.stringify(res.body)).toBe(true);
      };

      it('is reachable without a login and is not a 401', async () => {
        const res = await post({ call_id: randomUUID(), token: 'x'.repeat(32) });
        expect(res.status).not.toBe(401);
      });

      it('a missing or malformed token is a 400 in the standard shape', async () => {
        expectStandard(await post({}), 400);
        expectStandard(await post({ call_id: randomUUID() }), 400);
        expectStandard(await post({ call_id: randomUUID(), token: 'short' }), 400);
        expectStandard(await post({ call_id: 'not-a-uuid', token: 'x'.repeat(32) }), 400);
        expectStandard(await post({ call_id: randomUUID(), token: 'x'.repeat(5000) }), 400);
      });

      it('a wrong token, or a call that does not exist, is the same 404', async () => {
        expectStandard(await post({ call_id: randomUUID(), token: 'x'.repeat(32) }), 404);
        const callId = randomUUID();
        await stack.redis.set(
          `call:decline-token:${callId}`,
          JSON.stringify({ user_id: randomUUID(), token: 'the-real-one-time-token-123456' }),
          'PX',
          30_000,
        );
        const wrong = await post({ call_id: callId, token: 'the-wrong-one-time-token-12345' });
        expectStandard(wrong, 404);
        // the wrong guess did not consume the real token
        const right = await post({ call_id: callId, token: 'the-real-one-time-token-123456' });
        expect(right.status).toBe(204);
      });

      it('a bearer token is not needed and a bad one does not matter', async () => {
        const res = await post(
          { call_id: randomUUID(), token: 'x'.repeat(32) },
          { authorization: 'Bearer nonsense' },
        );
        expect(res.status).toBe(404);
      });
    },
  );

  it.each([
    ['a token that is not a token', 'Bearer nonsense'],
    ['an expired-looking JWT', 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.c2ln'],
    ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer', 'Bearer '],
    ['a token of 10000 characters', `Bearer ${'a'.repeat(10_000)}`],
    ['a NUL in the token', 'Bearer fake:al\u0000ice'],
  ])('%s is refused', async (_name, header) => {
    const res = await stack.call(null, 'GET', '/users/me', undefined, {
      authorization: header,
      'x-device-id': randomUUID(),
    });
    expect([400, 401]).toContain(res.status);
    expect(ErrorResponse.safeParse(res.body).success).toBe(true);
  });

  it('a valid login needs a device id that is a UUID', async () => {
    for (const device of [undefined, '', 'abc', '123', 'not-a-uuid-at-all-not-a-uuid-at-all-xx']) {
      const res = await stack.call(null, 'GET', '/users/me', undefined, {
        authorization: 'Bearer fake:loginuser',
        ...(device === undefined ? {} : { 'x-device-id': device }),
      });
      expect(res.status, `device id ${String(device)}`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const fine = await stack.call(null, 'GET', '/users/me', undefined, {
      authorization: 'Bearer fake:loginuser',
      'x-device-id': randomUUID(),
    });
    expect(fine.status).toBe(200);
  });

  it('a device id that belongs to another user is refused', async () => {
    const device = randomUUID();
    expect(
      (
        await stack.call(null, 'GET', '/users/me', undefined, {
          authorization: 'Bearer fake:first_user',
          'x-device-id': device,
        })
      ).status,
    ).toBe(200);
    const stolen = await stack.call(null, 'GET', '/users/me', undefined, {
      authorization: 'Bearer fake:second_user',
      'x-device-id': device,
    });
    expect(stolen.status).toBe(403);
  });

  it('a disabled account is refused at login', async () => {
    const device = randomUUID();
    await stack.call(null, 'GET', '/users/me', undefined, {
      authorization: 'Bearer fake:soon_gone',
      'x-device-id': device,
    });
    await stack.db
      .updateTable('users')
      .set({ status: 'disabled' })
      .where('clerk_id', '=', 'fake_clerk_soon_gone')
      .execute();
    const cached = await stack.redis.keys('auth:fake_clerk_soon_gone:*'); // the login cache would still know this user
    if (cached.length > 0) await stack.redis.del(...cached);
    const res = await stack.call(null, 'GET', '/users/me', undefined, {
      authorization: 'Bearer fake:soon_gone',
      'x-device-id': randomUUID(),
    });
    expect(res.status).toBe(403);
  });

  it('the sockets use the same checks', async () => {
    expect(await auth.authenticateSocket('fake:socketuser', randomUUID())).toMatchObject({
      deviceId: expect.any(String),
    });
    expect(await auth.authenticateSocket('nonsense', randomUUID())).toBeNull();
    expect(await auth.authenticateSocket('fake:socketuser', 'not-a-uuid')).toBeNull();
  });
});

describe('the test login can never be live', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('the config refuses E2E_FAKE_AUTH=true in production, even when everything else is right', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://flick.example.com',
      CLERK_SECRET_KEY: 'sk_live_x',
    };
    expect(() => loadConfig(production)).not.toThrow();
    expect(() => loadConfig({ ...production, E2E_FAKE_AUTH: 'true' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...production, E2E_FAKE_AUTH: 'true' })).toThrow(
      /must not be enabled when NODE_ENV=production/,
    );
    // "false" and an empty value are the off state and are fine
    expect(loadConfig({ ...production, E2E_FAKE_AUTH: 'false' }).E2E_FAKE_AUTH).toBe(false);
    expect(loadConfig({ ...production, E2E_FAKE_AUTH: '' }).E2E_FAKE_AUTH).toBe(false);
  });

  it('only the exact words true and false are accepted (no "1", "yes", "TRUE" sneaking a value past the production check)', () => {
    for (const value of ['1', 'yes', 'TRUE', 'True', ' true']) {
      expect(() =>
        loadConfig({
          ...base,
          NODE_ENV: 'production',
          CORS_ORIGINS: 'https://x.test',
          E2E_FAKE_AUTH: value,
        }),
      ).toThrow(ConfigError);
    }
  });

  it('the real Clerk client does not accept a fake token, so turning the flag off really turns the test login off', async () => {
    const clerk = createClerk(
      loadConfig({
        ...base,
        NODE_ENV: 'test',
        CLERK_SECRET_KEY: 'sk_test_000000000000000000000000000000000000',
      }),
    );
    await expect(clerk.verify('fake:alice')).rejects.toThrow();
    await expect(clerk.verify('')).rejects.toThrow();
  });

  it('without CLERK_SECRET_KEY the real Clerk client cannot even be built (the API refuses to start)', () => {
    expect(() => createClerk(loadConfig({ ...base, NODE_ENV: 'test' }))).toThrow(
      /CLERK_SECRET_KEY/,
    );
  });

  it('the fake login only accepts well-formed names', async () => {
    const clerk = createFakeClerk();
    for (const bad of [
      'fake:',
      'fake:a',
      'fake:a b',
      'fake:../x',
      `fake:${'a'.repeat(25)}`,
      'fake:ünï',
      'Fake:alice',
      'bearer fake:alice',
    ]) {
      await expect(clerk.verify(bad), bad).rejects.toThrow();
    }
  });

  it('a stack that uses the real login refuses the fake token on every protected route and on the socket', async () => {
    const stack = await startStack({
      databaseUrl: database.url,
      spreadIps: true,
      authenticate: (req, reply) => real.authenticate(req, reply),
    });
    const real = createAuth({
      db: stack.db,
      redis: stack.redis,
      clerk: createClerk(
        loadConfig({
          ...base,
          NODE_ENV: 'test',
          CLERK_SECRET_KEY: 'sk_test_000000000000000000000000000000000000',
        }),
      ),
    });
    try {
      const device = randomUUID();
      for (const path of ['/users/me', '/conversations', '/starred', '/calls', '/blocks']) {
        const res = await stack.call(null, 'GET', path, undefined, {
          authorization: 'Bearer fake:alice',
          'x-device-id': device,
        });
        expect(res.status, path).toBe(401);
      }
      expect(await real.authenticateSocket('fake:alice', device)).toBeNull();
      const users = await stack.db
        .selectFrom('users')
        .select('id')
        .where('username', '=', 'alice')
        .execute();
      expect(users).toEqual([]);
    } finally {
      await stack.stop();
    }
  });
});
