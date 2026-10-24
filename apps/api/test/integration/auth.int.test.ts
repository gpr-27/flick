/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { randomUUID } from 'node:crypto';
import { migrateUp } from '@chat/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createAuth, type Auth, type Clerk } from '../../src/modules/auth/index.js';
import { Redis } from '../../src/redis.js';

// A fake Clerk: the token "token-<name>" belongs to the Clerk user "user_<name>". Never calls Clerk.
let profileCalls = 0;
const clerk: Clerk = {
  verify: (token) =>
    token.startsWith('token-')
      ? Promise.resolve(`user_${token.slice(6)}`)
      : Promise.reject(new Error('bad token')),
  profile: (clerkId) => {
    profileCalls += 1;
    const name = clerkId.slice(5);
    return Promise.resolve({
      username: name,
      email: `${name}@example.com`,
      displayName: `${name} Person`,
      imageUrl: `https://img.example/${name}.png`,
    });
  },
};

const adminUrl = process.env.DATABASE_URL!;
const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
let db: ReturnType<typeof createDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let socketAuth: Auth['authenticateSocket'];

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: url.toString(),
    REDIS_URL: 'redis://127.0.0.1:1', // dead on purpose: the auth cache must be optional
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  });
  db = createDb(config.DATABASE_URL, 5);
  await migrateUp(db);
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
  const auth = createAuth({ db, redis, clerk });
  socketAuth = auth.authenticateSocket;
  app = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    redis,
    checks: [],
    isShuttingDown: () => false,
    // No authenticateSocket: this app has no gateway, so it never needs the (dead) Redis adapter.
    authenticate: auth.authenticate,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

/** Calls the API like a browser: bearer token plus a device id. */
async function call(
  who: string | null,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  opts: { device?: string | null; body?: object } = {},
) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer token-${who}`;
  const device = opts.device === undefined ? randomUUID() : opts.device;
  if (device) headers['x-device-id'] = device;
  const res = await app.inject({ method, url: path, headers, payload: opts.body });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null }; // eslint-disable-line
}

describe('authenticate', () => {
  it('rejects a missing or invalid token with 401', async () => {
    expect((await call(null, 'GET', '/users/me')).status).toBe(401);
    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: 'Bearer nonsense', 'x-device-id': randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing or malformed X-Device-Id with 400', async () => {
    expect((await call('zoe', 'GET', '/users/me', { device: null })).status).toBe(400);
    const bad = await call('zoe', 'GET', '/users/me', { device: 'not-a-uuid' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/X-Device-Id/);
  });

  it('creates the local user once and reuses it', async () => {
    const before = profileCalls;
    const first = await call('anna', 'GET', '/users/me');
    const second = await call('anna', 'GET', '/users/me');
    expect(first.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({
      username: 'anna',
      email: 'anna@example.com',
      display_name: 'anna Person',
      avatar_url: 'https://img.example/anna.png',
    });
    expect(profileCalls - before).toBe(1); // Clerk is asked for the profile only the first time
    const rows = await db
      .selectFrom('users')
      .select('id')
      .where('clerk_id', '=', 'user_anna')
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('upserts the device row and refuses a device id owned by someone else', async () => {
    const device = randomUUID();
    const a = await call('ben', 'GET', '/users/me', { device });
    await call('ben', 'GET', '/users/me', { device });
    const rows = await db.selectFrom('devices').selectAll().where('id', '=', device).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(a.body.id);

    const stolen = await call('cara', 'GET', '/users/me', { device });
    expect(stolen.status).toBe(403);
  });

  it('gives two users with the same Clerk username different local usernames', async () => {
    await db.insertInto('users').values({ username: 'dup', display_name: 'Existing' }).execute();
    const res = await call('dup', 'GET', '/users/me');
    expect(res.status).toBe(200);
    expect(res.body.username).toMatch(/^dup_[0-9a-f]{6}$/);
  });
});

describe('authenticateSocket', () => {
  it('returns the context for a valid token and device, null otherwise', async () => {
    const device = randomUUID();
    const ctx = await socketAuth('token-sam', device);
    expect(ctx).toEqual({ userId: expect.any(String), deviceId: device });
    expect(await socketAuth('nonsense', device)).toBeNull();
    expect(await socketAuth('token-sam', 'not-a-uuid')).toBeNull();
  });
});

describe('users', () => {
  it('updates the profile and validates it', async () => {
    const me = await call('uma', 'PATCH', '/users/me', {
      body: { display_name: 'Uma P', about: 'hello' },
    });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ display_name: 'Uma P', about: 'hello' });
    const tooLong = await call('uma', 'PATCH', '/users/me', { body: { about: 'x'.repeat(200) } });
    expect(tooLong.status).toBe(400);
  });

  it('finds people by name, not yourself', async () => {
    await call('vera', 'GET', '/users/me');
    await call('victor', 'GET', '/users/me');
    const res = await call('vera', 'GET', '/users/search?q=vic');
    expect(res.status).toBe(200);
    expect(res.body.items.map((u: { username: string }) => u.username)).toEqual(['victor']);
  });

  it('lists everyone A to Z by name, in pages, and hides blocked people from the list', async () => {
    // Fresh names so this does not depend on the other tests (they share one database).
    for (const name of ['dir_bea', 'dir_ada', 'dir_cy']) await call(name, 'GET', '/users/me');
    const ada = (await call('dir_ada', 'GET', '/users/me')).body as {
      id: string;
      display_name: string;
    };
    const cy = (await call('dir_cy', 'GET', '/users/me')).body as {
      id: string;
      display_name: string;
    };
    await call('dir_bea', 'POST', '/blocks', { body: { user_id: cy.id } });

    // One page of 2, then the rest: together they are the whole list in name order.
    type Page = { items: { display_name: string }[]; next_cursor: string | null };
    const first = await call('dir_bea', 'GET', '/users/directory?limit=2');
    const page1 = first.body as Page;
    expect(first.status).toBe(200);
    expect(page1.next_cursor).not.toBeNull();
    const second = await call(
      'dir_bea',
      'GET',
      `/users/directory?limit=2&cursor=${encodeURIComponent(page1.next_cursor ?? '')}`,
    );
    const page2 = second.body as Page;
    const people = [...page1.items, ...page2.items];
    const names = people.map((u) => u.display_name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // Ada is listed; cy is hidden because bea blocked him; bea never sees herself.
    expect(names).toContain(ada.display_name);
    expect(names).not.toContain(cy.display_name);
    expect(names.length).toBe(new Set(names).size);

    const bad = await call('dir_bea', 'GET', '/users/directory?cursor=%%%');
    expect(bad.status).toBe(400);
  });

  it('blocks, lists and unblocks; blocking is idempotent and hides you from search', async () => {
    const wes = (await call('wes', 'GET', '/users/me')).body;
    const walt = (await call('walt', 'GET', '/users/me')).body;
    expect((await call('wes', 'POST', '/blocks', { body: { user_id: walt.id } })).status).toBe(204);
    expect((await call('wes', 'POST', '/blocks', { body: { user_id: walt.id } })).status).toBe(204);
    expect((await call('wes', 'POST', '/blocks', { body: { user_id: wes.id } })).status).toBe(400);

    const list = await call('wes', 'GET', '/blocks');
    expect(list.body.items.map((b: { user: { id: string } }) => b.user.id)).toEqual([walt.id]);

    // walt can no longer find wes
    const search = await call('walt', 'GET', '/users/search?q=wes');
    expect(search.body.items).toEqual([]);

    expect((await call('wes', 'DELETE', `/blocks/${walt.id}`)).status).toBe(204);
    expect((await call('wes', 'GET', '/blocks')).body.items).toEqual([]);
  });
});
