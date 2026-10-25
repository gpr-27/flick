/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { migrateUp, createPool, createDb as createMigrationDb } from '@chat/db';
import pg from 'pg';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { buildApp, type AppDeps } from '../../src/app.js';
import type { Authenticate } from '../../src/auth-guard.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createRedis, type Redis } from '../../src/redis.js';

// The full stack the way main.ts wires it (HTTP routes, Socket.IO gateway, outbox dispatcher),
// with two test doubles: login is a pair of headers (x-user-id, x-device-id) and a socket token IS
// the user id. Everything else is real: Postgres, Redis, the Redis adapter, the dispatcher.
//
// Needs DATABASE_URL (any database on a Postgres server) and REDIS_URL, like the other
// integration tests: eval "$(scripts/dev/test-deps-up.sh)".

export interface TestUser {
  id: string;
  deviceId: string;
  name: string;
}

export interface TestDatabase {
  url: string;
  drop(): Promise<void>;
}

/** A fresh, migrated database on the test server. Each test file makes its own. */
export async function createDatabase(prefix = 'h'): Promise<TestDatabase> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('set DATABASE_URL (see scripts/dev/test-deps-up.sh)');
  const name = `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = createPool({ connectionString: url.toString() });
  await migrateUp(createMigrationDb(pool));
  await pool.end();
  return {
    url: url.toString(),
    async drop() {
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export interface StackOptions {
  databaseUrl: string;
  redisUrl?: string;
  /** Extra environment for loadConfig (for example RATE_LIMIT_MAX). */
  env?: Record<string, string>;
  /** Replace the fake login (for example to test the real one). */
  authenticate?: Authenticate;
  /** Pool size of the API's Postgres pool. */
  poolMax?: number;
  /**
   * On by default (pass false to turn off): every request gets its own client address
   * (X-Forwarded-For with TRUST_PROXY). The per-IP rate limit counters live in the Redis that all
   * test files share, so without this the hundreds of requests of one file, all from 127.0.0.1,
   * would use up the limit of the files that run after it.
   */
  spreadIps?: boolean;
  /** The AI chain (tests pass one with fake providers). */
  ai?: AppDeps['ai'];
}

export interface CallResult<T = any> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
}

export interface Stack {
  app: Awaited<ReturnType<typeof buildApp>>;
  db: Db;
  redis: Redis;
  config: Config;
  port: number;
  user(name: string, options?: UserOptions): Promise<TestUser>;
  /** A second login (device) for an existing user. */
  device(user: TestUser): Promise<TestUser>;
  call(
    user: TestUser | null,
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<CallResult>;
  connect(user: TestUser): Promise<Client>;
  stop(): Promise<void>;
}

export interface UserOptions {
  display_name?: string;
  status?: 'active' | 'disabled' | 'deleted';
  is_bot?: boolean;
}

function randomIp(): string {
  const n = () => Math.floor(Math.random() * 254) + 1;
  return `10.${String(n())}.${String(n())}.${String(n())}`;
}

const fakeLogin: Authenticate = async (req, reply) => {
  const userId = req.headers['x-user-id'];
  const deviceId = req.headers['x-device-id'];
  if (typeof userId !== 'string' || typeof deviceId !== 'string') {
    return void (await reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized', retryable: false } }));
  }
  req.auth = { userId, deviceId };
};

export async function startStack(options: StackOptions): Promise<Stack> {
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: redisUrl,
    RATE_LIMIT_MAX: '100000',
    ...(options.spreadIps !== false ? { TRUST_PROXY: 'true' } : {}),
    ...options.env,
  });
  const db = createDb(config.DATABASE_URL, options.poolMax ?? 20);
  const redis = createRedis(redisUrl);
  redis.on('error', () => undefined); // a stopped Redis must not crash the test process
  const app = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    redis,
    checks: [],
    isShuttingDown: () => false,
    authenticate: options.authenticate ?? fakeLogin,
    authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
    ai: options.ai,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  const clients = new Set<Client>();
  let counter = 0;

  const stack: Stack = {
    app,
    db,
    redis,
    config,
    port,
    async user(name, opts = {}) {
      counter += 1;
      const username = `${name}_${counter}_${randomUUID().slice(0, 5)}`.toLowerCase();
      const user = await db
        .insertInto('users')
        .values({
          username,
          display_name: opts.display_name ?? `${name} ${String(counter)}`,
          status: opts.status ?? 'active',
          is_bot: opts.is_bot ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const device = await db
        .insertInto('devices')
        .values({ user_id: user.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: user.id, deviceId: device.id, name: username };
    },
    async device(user) {
      const device = await db
        .insertInto('devices')
        .values({ user_id: user.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { ...user, deviceId: device.id };
    },
    async call(user, method, url, body, headers = {}) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: {
          ...(user ? { 'x-user-id': user.id, 'x-device-id': user.deviceId } : {}),
          ...(options.spreadIps !== false ? { 'x-forwarded-for': randomIp() } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { payload: body as object }),
      });
      let parsed: any = res.body;
      if (String(res.headers['content-type']).includes('json') && res.body) {
        parsed = JSON.parse(res.body);
      }
      return { status: res.statusCode, body: parsed, headers: res.headers };
    },
    async connect(user) {
      const client = await connectSocket(port, user);
      clients.add(client);
      return client;
    },
    async stop() {
      for (const c of clients) c.close();
      await app.close();
      await db.destroy();
      redis.disconnect();
    },
  };
  return stack;
}

// ------------------------------------------------------------------ Socket.IO client

export interface Received {
  name: string;
  payload: any;
}

export interface Client {
  socket: ClientSocket;
  events: Received[];
  /** Resolves with the ack of an event. */
  emit(event: string, payload: unknown): Promise<any>;
  /** All received events with this name (a copy). */
  of(name: string): any[];
  /** new_message payload records received so far, in arrival order. */
  messages(): any[];
  waitFor(predicate: (events: Received[]) => boolean, timeoutMs?: number): Promise<void>;
  close(): void;
}

export async function connectSocket(port: number, user: TestUser): Promise<Client> {
  const socket = connectClient(`http://127.0.0.1:${String(port)}`, {
    auth: { token: user.id, deviceId: user.deviceId },
    transports: ['websocket'],
    reconnection: false,
  });
  const events: Received[] = [];
  socket.onAny((name, payload) => events.push({ name, payload }));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return {
    socket,
    events,
    emit: (event, payload) =>
      new Promise((resolve) => {
        socket.timeout(10_000).emit(event, payload, (err: unknown, ack: unknown) => {
          resolve(err ? { ok: false, error: { code: 'CLIENT_TIMEOUT' } } : ack);
        });
      }),
    of: (name) => events.filter((e) => e.name === name).map((e) => e.payload),
    messages: () => events.filter((e) => e.name === 'new_message').map((e) => e.payload.message),
    waitFor: (predicate, timeoutMs = 8_000) => waitUntil(() => predicate(events), timeoutMs),
    close: () => void socket.close(),
  };
}

/**
 * How much longer than the stated time the waits below may take. The tests wait for things that
 * are quick on an idle machine (the dispatcher polls every 200 ms) and slow on a busy one, so the
 * stated times are a floor; TEST_TIME_FACTOR=1 gives the strict versions.
 */
const TIME_FACTOR = Number(process.env.TEST_TIME_FACTOR ?? 4);

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 8_000,
  what = 'condition',
): Promise<void> {
  const deadline = Date.now() + timeoutMs * TIME_FACTOR;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Waits until the dispatcher has published every outbox row (all events are on the wire). */
export async function waitForOutboxDrained(db: Db, timeoutMs = 10_000): Promise<void> {
  await waitUntil(
    async () => {
      const row = await db
        .selectFrom('outbox')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('published_at', 'is', null)
        .executeTakeFirstOrThrow();
      return Number(row.n) === 0;
    },
    timeoutMs,
    'the outbox to drain',
  );
}

// ------------------------------------------------------------------ data helpers

export async function direct(stack: Stack, a: TestUser, b: TestUser): Promise<string> {
  const res = await stack.call(a, 'POST', '/conversations/direct', { user_id: b.id });
  if (res.status !== 200 && res.status !== 201) throw new Error(`direct failed ${res.status}`);
  return res.body.id as string;
}

export async function group(
  stack: Stack,
  owner: TestUser,
  members: TestUser[],
  title = 'Test group',
): Promise<string> {
  const res = await stack.call(owner, 'POST', '/conversations/group', {
    title,
    member_ids: members.map((m) => m.id),
  });
  if (res.status !== 201) throw new Error(`group failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/** An uploaded attachment row owned by `owner`, as if the upload had completed. */
export async function attachment(
  db: Db,
  owner: TestUser,
  kind: 'image' | 'video' | 'file' | 'voice' = 'image',
): Promise<string> {
  const mime = {
    image: 'image/png',
    video: 'video/mp4',
    file: 'application/pdf',
    voice: 'audio/webm',
  }[kind];
  const row = await db
    .insertInto('attachments')
    .values({
      owner_id: owner.id,
      object_key: `messages/${owner.id}/${randomUUID()}`,
      file_name: kind === 'file' ? 'report.pdf' : null,
      declared_mime: mime,
      verified_mime: mime,
      size_bytes: 1234,
      sha256: createHash('sha256').update(randomUUID()).digest(),
      status: 'uploaded',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export function cmid(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** REST send. Returns the raw result so tests can look at errors too. */
export function send(stack: Stack, user: TestUser, conversationId: string, content: unknown) {
  return stack.call(user, 'POST', `/conversations/${conversationId}/messages`, {
    client_message_id: cmid(),
    content,
  });
}
