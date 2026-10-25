import { randomUUID } from 'node:crypto';
import { migrateUp } from '@chat/db';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import type { PushSender } from '../../src/modules/push/sender.js';
import { Redis } from '../../src/redis.js';

export interface StartOptions {
  /** A fake Web Push sender; with it (and a VAPID key) push features work without a push service. */
  pushSender?: PushSender;
  vapidPublicKey?: string;
}

// A fresh, migrated database on the test Postgres (DATABASE_URL from the test compose), plus an
// app whose `authenticate` trusts an x-user-id header. Real auth is another module's job.
export async function startTestApp(options: StartOptions = {}) {
  const adminUrl = process.env.DATABASE_URL!;
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: url.toString(),
    REDIS_URL: 'redis://127.0.0.1:1',
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
    ...(options.vapidPublicKey ? { VAPID_PUBLIC_KEY: options.vapidPublicKey } : {}),
  });
  const db = createDb(config.DATABASE_URL, 10);
  await migrateUp(db);

  const app = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    redis: new Redis(config.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false }),
    checks: [],
    isShuttingDown: () => false,
    pushSender: options.pushSender,
    authenticate: async (req, reply) => {
      const userId = req.headers['x-user-id'];
      if (typeof userId !== 'string') return void (await reply.code(401).send({}));
      // A test may name the device (x-device-id); otherwise the device id is the user id.
      const device = req.headers['x-device-id'];
      req.auth = { userId, deviceId: typeof device === 'string' ? device : userId };
    },
  });
  await app.ready();

  let n = 0;
  return {
    app,
    db,
    /** A signed-in device (a row in `devices`) of the user. */
    async makeDevice(userId: string): Promise<string> {
      const d = await db
        .insertInto('devices')
        .values({ user_id: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return d.id;
    },
    async makeUser(): Promise<string> {
      n += 1;
      const u = await db
        .insertInto('users')
        .values({ username: `user_${n}_${randomUUID().slice(0, 6)}`, display_name: `User ${n}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      return u.id;
    },
    /** Calls the API as `userId`. */
    async call(
      userId: string,
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      body?: unknown,
      deviceId?: string,
    ) {
      const res = await app.inject({
        method,
        url: path,
        headers: { 'x-user-id': userId, ...(deviceId ? { 'x-device-id': deviceId } : {}) },
        ...(body === undefined ? {} : { payload: body as object }),
      });
      return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null }; // eslint-disable-line
    },
    async stop() {
      await app.close();
      await db.destroy();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
