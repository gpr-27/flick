import { randomUUID } from 'node:crypto';
import { createDb as createKysely, createPool, migrateUp } from '@chat/db';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import type { Authenticate } from '../../src/auth-guard.js';
import { loadConfig } from '../../src/config.js';
import type { Db } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { Redis } from '../../src/redis.js';

// Needs a Postgres server (TEST_DATABASE_URL, any database on it). Each test file creates its
// own database there, so files can run in parallel.
export async function createTestDb() {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('set TEST_DATABASE_URL to a Postgres server for these tests');
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = createPool({ connectionString: url.toString(), max: 40 });
  pool.on('error', () => undefined); // idle clients are cut when the database is dropped
  const db: Db = createKysely(pool);
  await migrateUp(db);
  return {
    db,
    url: url.toString(),
    destroy: async () => {
      await db.destroy();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

/** A fake login: the test says who is calling with x-user-id and x-device-id headers. */
const fakeAuthenticate: Authenticate = async (req) => {
  req.auth = {
    userId: String(req.headers['x-user-id']),
    deviceId: String(req.headers['x-device-id']),
  };
  await Promise.resolve();
};

export async function createTestApp(db: Db, url: string) {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: url,
    REDIS_URL: 'redis://127.0.0.1:1',
    RATE_LIMIT_MAX: '100000',
  });
  const app = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    // Never connects: the rate limiter lets requests through when Redis fails.
    redis: new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false }),
    checks: [],
    isShuttingDown: () => false,
    authenticate: fakeAuthenticate,
  });
  await app.ready();
  return app;
}

export interface TestUser {
  id: string;
  deviceId: string;
}

export async function makeUser(db: Db, name: string): Promise<TestUser> {
  const username = `${name}_${randomUUID().slice(0, 8)}`;
  const user = await db
    .insertInto('users')
    .values({ username, display_name: username })
    .returning('id')
    .executeTakeFirstOrThrow();
  const device = await db
    .insertInto('devices')
    .values({ user_id: user.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: user.id, deviceId: device.id };
}

export async function makeConversation(
  db: Db,
  type: 'direct' | 'group',
  members: { user: TestUser; role?: 'owner' | 'admin' | 'member' }[],
  settings: { disappearing_seconds?: number } = {},
): Promise<string> {
  const conv = await db
    .insertInto('conversations')
    .values({ type, name: type === 'group' ? 'a group' : null, ...settings })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(
      members.map((m) => ({
        conversation_id: conv.id,
        user_id: m.user.id,
        role: m.role ?? 'member',
      })),
    )
    .execute();
  return conv.id;
}

export function asUser(user: TestUser) {
  return { userId: user.id, deviceId: user.deviceId };
}

export function headers(user: TestUser) {
  return { 'x-user-id': user.id, 'x-device-id': user.deviceId };
}

export function text(body: string) {
  return { type: 'text' as const, text: body };
}
