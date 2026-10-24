/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- test payloads are untyped */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { migrateUp } from '@chat/db';
import { sql } from 'kysely';
import pg from 'pg';
import { io as connectClient, type Socket } from 'socket.io-client';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createRedis } from '../../src/redis.js';

// Shared pieces of the gate tests: the REAL app (Fastify + Socket.IO gateway + outbox dispatcher)
// on port 0, real Postgres and Redis, real socket.io-client sockets. Only Clerk is faked:
// a REST caller says who it is with x-user-id / x-device-id headers, and a socket's token IS the
// user id.

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `check` is true. Fails with `what` after `ms`, so a bug is a clear failure, not a hang. */
export async function eventually(
  check: () => boolean | Promise<boolean>,
  what = 'condition',
  ms = 10_000,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

export interface GateUser {
  id: string;
  deviceId: string;
}

/** A fresh, migrated database on the test Postgres. Apps started with `startApp` share it. */
export async function createGateDb() {
  const adminUrl = process.env.DATABASE_URL!;
  const name = `gate_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();

  const db = createDb(databaseUrl, 10);
  await migrateUp(db);

  const apps: GateApp[] = [];
  const sockets: Socket[] = [];

  /** One API process: HTTP + Socket.IO gateway + dispatcher, listening on a random port. */
  async function startApp(): Promise<GateApp> {
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      RATE_LIMIT_MAX: '1000000',
    });
    const redis = createRedis(config.REDIS_URL);
    const app = await buildApp({
      config,
      logger: createLogger('silent'),
      db,
      redis,
      checks: [],
      isShuttingDown: () => false,
      authenticate: async (req, reply) => {
        const userId = req.headers['x-user-id'];
        const deviceId = req.headers['x-device-id'];
        if (typeof userId !== 'string' || typeof deviceId !== 'string') {
          return void (await reply.code(401).send({}));
        }
        req.auth = { userId, deviceId };
      },
      authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
    });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    const port = (app.server.address() as AddressInfo).port;

    const gateApp: GateApp = {
      url,
      port,
      async stop() {
        await app.close();
        await redis.quit().catch(() => undefined); // QUIT waits for commands still in flight
      },
      async rest(user, method, path, body) {
        const res = await fetch(`${url}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            'x-user-id': user.id,
            'x-device-id': user.deviceId,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      },
      async connect(user) {
        const socket = connectClient(url, {
          auth: { token: user.id, deviceId: user.deviceId },
          transports: ['websocket'],
          reconnection: false,
        });
        sockets.push(socket);
        const events: { name: string; payload: any }[] = [];
        socket.onAny((name, payload) => events.push({ name, payload }));
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('connect_error', reject);
        });
        const request = (event: string, payload: unknown) =>
          new Promise<{ ok: boolean; data?: any; error?: { code: string } }>((resolve) =>
            socket.emit(event, payload, resolve),
          );
        return {
          socket,
          events,
          of: (name: string) => events.filter((e) => e.name === name).map((e) => e.payload),
          request,
          send: (conversationId: string, text: string, clientMessageId = `cm_${randomUUID()}`) =>
            request('send_message', {
              conversation_id: conversationId,
              client_message_id: clientMessageId,
              content: { type: 'text', text },
            }),
          /**
           * A socket answers its requests in order, so once this returns, every event the server
           * emitted to this socket earlier has arrived too. It replaces "sleep and hope".
           */
          flush: () => request('presence_subscribe', { user_ids: [] }),
        };
      },
    };
    apps.push(gateApp);
    return gateApp;
  }

  async function makeUser(): Promise<GateUser> {
    const user = await db
      .insertInto('users')
      .values({
        username: `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        display_name: 'User',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const device = await db
      .insertInto('devices')
      .values({ user_id: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: user.id, deviceId: device.id };
  }

  /** A group whose first user is the owner. */
  async function makeGroup(users: GateUser[]): Promise<string> {
    const conversation = await db
      .insertInto('conversations')
      .values({ type: 'group', name: 'gate group', created_by: users[0]!.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('conversation_members')
      .values(
        users.map((u, i) => ({
          conversation_id: conversation.id,
          user_id: u.id,
          role: i === 0 ? ('owner' as const) : ('member' as const),
        })),
      )
      .execute();
    return conversation.id;
  }

  /** True when every outbox row of the conversation has been dispatched. */
  async function outboxDone(conversationId: string): Promise<boolean> {
    const rows = await db
      .selectFrom('outbox')
      .select('published_at')
      .where('partition_key', '=', conversationId)
      .execute();
    return rows.length > 0 && rows.every((r) => r.published_at !== null);
  }

  async function notifyJobs(conversationId: string): Promise<{ user_id: string; seq: number }[]> {
    const { rows } = await sql<{ data: { user_id: string; seq: number } }>`
      SELECT data FROM pgboss.job
      WHERE name = 'notify' AND data->>'conversation_id' = ${conversationId}`.execute(db);
    return rows.map((r) => r.data);
  }

  return {
    db,
    databaseUrl,
    startApp,
    makeUser,
    makeGroup,
    outboxDone,
    notifyJobs,
    async destroy() {
      for (const s of sockets) s.close();
      for (const a of apps.splice(0)) await a.stop().catch(() => undefined);
      await db.destroy();
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export type GateClient = Awaited<ReturnType<GateApp['connect']>>;

export interface GateApp {
  url: string;
  port: number;
  stop(): Promise<void>;
  rest(
    user: GateUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }>;
  connect(user: GateUser): Promise<{
    socket: Socket;
    events: { name: string; payload: any }[];
    of(name: string): any[];
    request(
      event: string,
      payload: unknown,
    ): Promise<{ ok: boolean; data?: any; error?: { code: string } }>;
    send(
      conversationId: string,
      text: string,
      clientMessageId?: string,
    ): Promise<{ ok: boolean; data?: any; error?: { code: string } }>;
    flush(): Promise<unknown>;
  }>;
}

export type GateDb = Awaited<ReturnType<typeof createGateDb>>;
export type { Db };

/**
 * The client-side rule every Flick client follows: keep one entry per seq, show them in seq
 * order. This is what makes a duplicate or reordered delivery harmless.
 */
export function dedupeBySeq<T extends { seq: number }>(items: T[]): T[] {
  const bySeq = new Map<number, T>();
  for (const item of items) if (!bySeq.has(item.seq)) bySeq.set(item.seq, item);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
