import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';
import pg from 'pg';
import { inject } from 'vitest';

import { createDb, createPool } from '../src/db.js';
import { migrateUp } from '../src/migrator.js';
import type { ConversationType, Database, MemberRole } from '../src/types.js';

export interface TestDatabase {
  db: Kysely<Database>;
  pool: pg.Pool;
  url: string;
  name: string;
  /** Drops the database. Call in afterAll. */
  destroy: () => Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A fresh, empty database on the shared test server; migrated unless `migrate: false`. */
export async function createTestDatabase(
  options: { migrate?: boolean; poolMax?: number } = {},
): Promise<TestDatabase> {
  const adminUrl = inject('pgAdminUrl');
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = withDatabase(adminUrl, name);
  const pool = createPool({ connectionString: url, max: options.poolMax ?? 30 });
  // Idle clients receive 57P01 when the database is force-dropped at teardown; that is expected.
  pool.on('error', (err: Error & { code?: string }) => {
    if (err.code !== '57P01') throw err;
  });
  const db = createDb(pool);
  if (options.migrate !== false) await migrateUp(db);

  return {
    db,
    pool,
    url,
    name,
    destroy: async () => {
      await db.destroy();
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

let counter = 0;

export async function makeUser(db: Kysely<Database>, overrides: { username?: string } = {}) {
  counter += 1;
  const username = overrides.username ?? `user_${counter}_${randomUUID().slice(0, 8)}`;
  const user = await db
    .insertInto('users')
    .values({ username, display_name: username, email: `${username}@example.com` })
    .returning(['id', 'username'])
    .executeTakeFirstOrThrow();
  const device = await db
    .insertInto('devices')
    .values({ user_id: user.id, name: 'test device' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: user.id, username: user.username, deviceId: device.id };
}

export async function addDevice(db: Kysely<Database>, userId: string): Promise<string> {
  const d = await db
    .insertInto('devices')
    .values({ user_id: userId, name: 'second device' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return d.id;
}

export async function makeConversation(
  db: Kysely<Database>,
  type: ConversationType,
  members: { userId: string; role?: MemberRole }[],
  settings: { disappearing_seconds?: number; admin_only_send?: boolean } = {},
): Promise<string> {
  const conv = await db
    .insertInto('conversations')
    .values({
      type,
      name: type === 'direct' ? null : `group ${randomUUID().slice(0, 6)}`,
      ...settings,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (members.length > 0) {
    await db
      .insertInto('conversation_members')
      .values(
        members.map((m) => ({
          conversation_id: conv.id,
          user_id: m.userId,
          role: m.role ?? 'member',
        })),
      )
      .execute();
  }
  return conv.id;
}

/** Asserts that a promise rejects with the given Postgres SQLSTATE (and optional constraint). */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; constraint?: string; message?: string };
    if (e.code !== code) {
      throw new Error(`expected SQLSTATE ${code}, got ${String(e.code)}: ${String(e.message)}`, {
        cause: err,
      });
    }
    if (constraint && e.constraint !== constraint) {
      throw new Error(`expected constraint ${constraint}, got ${String(e.constraint)}`, {
        cause: err,
      });
    }
    return;
  }
  throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
}
