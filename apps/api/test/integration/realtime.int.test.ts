/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- test payloads are untyped */
import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDb as createMigrationDb, createPool, migrateUp } from '@chat/db';
import { sql } from 'kysely';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createDispatcher, NOTIFY_QUEUE } from '../../src/modules/dispatcher/index.js';
import { dispatchRow } from '../../src/modules/dispatcher/dispatch.js';
import { attachGateway } from '../../src/modules/gateway/index.js';
import { createRedis, type Redis } from '../../src/redis.js';
import { closeIo, createIo } from '../../src/ws.js';

// Needs real Postgres and Redis (DATABASE_URL, REDIS_URL). The token a test client sends IS the
// user id; "bad" is rejected. Real token checking (Clerk) is another module's job.
const logger = createLogger('silent');
let db: Db;
let redis: Redis;
let boss: PgBoss;
let dropDatabase: () => Promise<void>;
let databaseUrl: string;

beforeAll(async () => {
  const adminUrl = process.env.DATABASE_URL ?? '';
  const name = `rt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  databaseUrl = url.toString();
  const pool = createPool({ connectionString: databaseUrl });
  await migrateUp(createMigrationDb(pool));
  await pool.end();
  db = createDb(databaseUrl, 10);
  redis = createRedis(process.env.REDIS_URL ?? '');
  boss = new PgBoss({ connectionString: databaseUrl, max: 2, supervise: false, schedule: false });
  await boss.start();
  await boss.createQueue(NOTIFY_QUEUE);
  dropDatabase = async () => {
    await boss.stop({ graceful: false });
    await db.destroy();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  };
});
afterAll(async () => {
  await redis.flushdb();
  await redis.quit().catch(() => undefined); // QUIT waits for commands still in flight
  await dropDatabase();
});
beforeEach(async () => {
  await db.deleteFrom('outbox').execute();
});

// ------------------------------------------------------------------ helpers

const instances: Instance[] = [];
const clients: ClientSocket[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const i of instances.splice(0)) await i.stop();
});

interface Instance {
  port: number;
  io: ReturnType<typeof createIo>;
  dispatcher: ReturnType<typeof createDispatcher>;
  stop(): Promise<void>;
}

/** One API replica: its own Socket.IO server on port 0, all sharing the same Redis. */
async function startInstance(options: {
  dispatch: boolean;
  onMessageCreated?: (message: { id: string }) => void;
}): Promise<Instance> {
  const http: HttpServer = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const own = createRedis(process.env.REDIS_URL ?? '');
  const io = createIo(http, own, []);
  const gateway = attachGateway(io, {
    db,
    redis: own,
    logger,
    authenticateSocket: (token, deviceId) =>
      Promise.resolve(token === 'bad' ? null : { userId: token, deviceId }),
  });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: 'redis://x',
  });
  const dispatcher = createDispatcher({
    db,
    io,
    config,
    boss,
    logger,
    pollMs: 50,
    onMessageCreated: options.onMessageCreated,
  });
  if (options.dispatch) dispatcher.start();
  const instance: Instance = {
    port: (http.address() as AddressInfo).port,
    io,
    dispatcher,
    async stop() {
      await dispatcher.stop();
      await gateway.close();
      await closeIo(io);
      await own.quit().catch(() => undefined);
    },
  };
  instances.push(instance);
  return instance;
}

/** A connected client that records every event it receives. */
async function connect(instance: Instance, userId: string, deviceId: string) {
  const socket = connectClient(`http://127.0.0.1:${instance.port}`, {
    auth: { token: userId, deviceId },
    transports: ['websocket'],
    reconnection: false,
  });
  clients.push(socket);
  const events: { name: string; payload: any }[] = []; // eslint-disable-line
  socket.onAny((name, payload) => events.push({ name, payload }));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return {
    socket,
    of: (name: string) => events.filter((e) => e.name === name).map((e) => e.payload),
  };
}

const ack = <T>(socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<{ ok: boolean; data?: T; error?: { code: string } }>((resolve) =>
    socket.emit(event, payload, resolve),
  );

const send = (socket: ClientSocket, conversationId: string, text = 'hi') =>
  ack<{ seq: number }>(socket, 'send_message', {
    conversation_id: conversationId,
    client_message_id: `cm_${randomUUID()}`,
    content: { type: 'text', text },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean | Promise<boolean>, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for condition');
}

async function makeUser(devices = 1) {
  const u = await db
    .insertInto('users')
    .values({ username: `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`, display_name: 'User' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const ids: string[] = [];
  for (let i = 0; i < devices; i++) {
    const d = await db
      .insertInto('devices')
      .values({ user_id: u.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(d.id);
  }
  return { id: u.id, devices: ids };
}

async function makeGroup(userIds: string[]) {
  const c = await db
    .insertInto('conversations')
    .values({ type: 'group', name: 'g', created_by: userIds[0]! })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(userIds.map((user_id) => ({ conversation_id: c.id, user_id })))
    .execute();
  return c.id;
}

async function makeDirect(a: string, b: string) {
  const c = await db
    .insertInto('conversations')
    .values({ type: 'direct', created_by: a })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values([a, b].map((user_id) => ({ conversation_id: c.id, user_id })))
    .execute();
  return c.id;
}

// -------------------------------------------------------------------- tests

describe('calls and the bot', () => {
  const sdp = { type: 'offer', sdp: 'v=0' };

  it('logs an answered call once, with its chat message', async () => {
    const api = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const bob = await makeUser();
    const conv = await makeDirect(alice.id, bob.id);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);
    const callId = randomUUID();

    await ack(a.socket, 'call_offer', {
      call_id: callId,
      conversation_id: conv,
      media: 'video',
      sdp,
    });
    await eventually(() => b.of('call_offer').length > 0);
    await ack(b.socket, 'call_answer', { call_id: callId, sdp: { ...sdp, type: 'answer' } });
    await ack(a.socket, 'call_end', { call_id: callId, reason: 'hangup' });
    await ack(a.socket, 'call_end', { call_id: callId, reason: 'hangup' }); // a repeat changes nothing

    await eventually(async () => {
      const rows = await db.selectFrom('call_logs').selectAll().where('id', '=', callId).execute();
      return rows.length === 1;
    });
    const log = await db
      .selectFrom('call_logs')
      .selectAll()
      .where('id', '=', callId)
      .executeTakeFirstOrThrow();
    expect(log).toMatchObject({ status: 'completed', type: 'video', caller_id: alice.id });
    const events = await db
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', conv)
      .where('type', '=', 'call_event')
      .execute();
    expect(events).toHaveLength(1);
  });

  it('logs a call the callee rejects as rejected', async () => {
    const api = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const bob = await makeUser();
    const conv = await makeDirect(alice.id, bob.id);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);
    const callId = randomUUID();

    await ack(a.socket, 'call_offer', {
      call_id: callId,
      conversation_id: conv,
      media: 'audio',
      sdp,
    });
    await eventually(() => b.of('call_offer').length > 0);
    await ack(b.socket, 'call_reject', { call_id: callId });

    await eventually(async () => {
      const row = await db
        .selectFrom('call_logs')
        .select('status')
        .where('id', '=', callId)
        .executeTakeFirst();
      return row?.status === 'rejected';
    });
  });

  it('hands every new message to the bot hook after delivery', async () => {
    const seen: string[] = [];
    const api = await startInstance({
      dispatch: true,
      onMessageCreated: (m) => void seen.push(m.id),
    });
    const alice = await makeUser();
    const bob = await makeUser();
    const conv = await makeGroup([alice.id, bob.id]);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);

    await send(a.socket, conv, '@flick hello');
    await eventually(() => b.of('new_message').length > 0 && seen.length > 0);
    expect(seen).toEqual([b.of('new_message')[0].message.message_id]);
  });
});

describe('handshake', () => {
  it('rejects a bad token and puts a good one in its rooms', async () => {
    const api = await startInstance({ dispatch: false });
    await expect(connect(api, 'bad', randomUUID())).rejects.toThrow('unauthorized');

    const device = randomUUID();
    await connect(api, 'user-1', device);
    const sockets = await api.io.in('user:user-1').fetchSockets();
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.rooms.has(`device:${device}`)).toBe(true);
  });
});

describe('dispatching a sent message', () => {
  it('reaches the other member once, not the sending device, and the sender other device', async () => {
    const api = await startInstance({ dispatch: true });
    const alice = await makeUser(2);
    const bob = await makeUser();
    const conv = await makeGroup([alice.id, bob.id]);
    const a1 = await connect(api, alice.id, alice.devices[0]!);
    const a2 = await connect(api, alice.id, alice.devices[1]!);
    const b1 = await connect(api, bob.id, bob.devices[0]!);

    const sent = await send(a1.socket, conv);
    expect(sent.ok).toBe(true);

    await eventually(() => b1.of('new_message').length > 0 && a2.of('new_message').length > 0);
    await sleep(300); // a duplicate, if there were one, would have arrived by now
    expect(b1.of('new_message')).toHaveLength(1);
    expect(b1.of('new_message')[0].message.seq).toBe(sent.data!.seq);
    expect(a2.of('new_message')).toHaveLength(1);
    expect(a1.of('new_message')).toHaveLength(0);
  });

  it('emits again after a crash between emit and marking; the client dedupes by seq', async () => {
    const api = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const bob = await makeUser();
    const conv = await makeGroup([alice.id, bob.id]);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);
    await send(a.socket, conv);

    // Crash: the emit happens, then the transaction dies before the row is marked.
    const row = await db.selectFrom('outbox').selectAll().executeTakeFirstOrThrow();
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://x',
    });
    await db
      .transaction()
      .execute(async (trx) => {
        await dispatchRow(row, { db: trx, io: api.io, config, boss });
        throw new Error('process died');
      })
      .catch(() => undefined);
    await eventually(() => b.of('new_message').length === 1);
    const pending = await db.selectFrom('outbox').select('published_at').execute();
    expect(pending.every((r) => r.published_at === null)).toBe(true);

    // After the restart the dispatcher picks the row up again.
    await api.dispatcher.runOnce();
    await eventually(() => b.of('new_message').length === 2);
    const seqs = new Set(b.of('new_message').map((e) => e.message.seq));
    expect(seqs.size).toBe(1); // a client that dedupes by seq shows one message
    expect(await db.selectFrom('outbox').select('published_at').execute()).toSatisfy(
      (rows: { published_at: Date | null }[]) => rows.every((r) => r.published_at !== null),
    );
  });

  it('does not deliver to a member who was removed', async () => {
    const api = await startInstance({ dispatch: true });
    const [alice, bob, carol] = [await makeUser(), await makeUser(), await makeUser()];
    const conv = await makeGroup([alice.id, bob.id, carol.id]);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);
    const c = await connect(api, carol.id, carol.devices[0]!);
    await db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', conv)
      .where('user_id', '=', bob.id)
      .execute();

    await send(a.socket, conv);
    await eventually(() => c.of('new_message').length === 1);
    await sleep(300);
    expect(b.of('new_message')).toHaveLength(0);
  });

  it('works across two API instances sharing Redis', async () => {
    const instanceA = await startInstance({ dispatch: true });
    const instanceB = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const bob = await makeUser();
    const conv = await makeGroup([alice.id, bob.id]);
    const a = await connect(instanceA, alice.id, alice.devices[0]!);
    const b = await connect(instanceB, bob.id, bob.devices[0]!);

    await send(a.socket, conv);
    await eventually(() => b.of('new_message').length === 1);
  });

  it('queues a notify job for each unmuted recipient (delayed for a connected one)', async () => {
    const api = await startInstance({ dispatch: true });
    const [alice, bob, carol, dave] = [
      await makeUser(),
      await makeUser(),
      await makeUser(),
      await makeUser(),
    ];
    const conv = await makeGroup([alice.id, bob.id, carol.id, dave.id]);
    await db
      .updateTable('conversation_members')
      .set({ muted_until: sql<Date>`now() + interval '1 day'` })
      .where('user_id', '=', carol.id)
      .execute();
    const a = await connect(api, alice.id, alice.devices[0]!);
    await connect(api, dave.id, dave.devices[0]!); // online: a delayed job

    const sent = await send(a.socket, conv);
    await eventually(async () => {
      const { rows } = await sql<{ data: { user_id: string; seq: number } }>`
        SELECT data FROM pgboss.job WHERE name = ${NOTIFY_QUEUE}`.execute(db);
      const users = rows.filter((r) => r.data.seq === sent.data!.seq).map((r) => r.data.user_id);
      return users.includes(bob.id) && users.includes(dave.id);
    });
    const { rows } = await sql<{ data: { user_id: string; seq: number; conversation_id: string } }>`
      SELECT data FROM pgboss.job WHERE name = ${NOTIFY_QUEUE}`.execute(db);
    const users = rows.filter((r) => r.data.conversation_id === conv).map((r) => r.data.user_id);
    expect(users.sort()).toEqual([bob.id, dave.id].sort()); // not carol (muted), not the sender
  });
});

describe('presence', () => {
  it('stays online until the last device is gone', async () => {
    const api = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const bob = await makeUser(2);
    await makeGroup([alice.id, bob.id]);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b1 = await connect(api, bob.id, bob.devices[0]!);
    const b2 = await connect(api, bob.id, bob.devices[1]!);

    await sleep(200); // let the connect-time presence writes finish before watching
    const status = await ack<{ user_id: string; online: boolean }[]>(
      a.socket,
      'presence_subscribe',
      { user_ids: [bob.id] },
    );
    expect(status.data).toEqual([expect.objectContaining({ user_id: bob.id, online: true })]);

    b1.socket.close();
    await sleep(300);
    expect(a.of('presence_update')).toHaveLength(0); // still online through the other device

    b2.socket.close();
    await eventually(() => a.of('presence_update').length === 1);
    expect(a.of('presence_update')[0]).toMatchObject({ user_id: bob.id, online: false });
    const stored = await db
      .selectFrom('users')
      .select('last_seen_at')
      .where('id', '=', bob.id)
      .executeTakeFirst();
    expect(stored?.last_seen_at).not.toBeNull();
  });

  it('only lets you watch users who share a conversation with you', async () => {
    const api = await startInstance({ dispatch: false });
    const alice = await makeUser();
    const stranger = await makeUser();
    const a = await connect(api, alice.id, alice.devices[0]!);
    const status = await ack<unknown[]>(a.socket, 'presence_subscribe', {
      user_ids: [stranger.id],
    });
    expect(status.data).toEqual([]);
  });
});

describe('typing', () => {
  it('is throttled and goes to conversation members only', async () => {
    const api = await startInstance({ dispatch: false });
    const [alice, bob, outsider] = [await makeUser(), await makeUser(), await makeUser()];
    const conv = await makeGroup([alice.id, bob.id]);
    const a = await connect(api, alice.id, alice.devices[0]!);
    const b = await connect(api, bob.id, bob.devices[0]!);
    const o = await connect(api, outsider.id, outsider.devices[0]!);

    for (let i = 0; i < 3; i++) a.socket.emit('typing_start', { conversation_id: conv });
    o.socket.emit('typing_start', { conversation_id: conv }); // not a member: dropped
    await eventually(() => b.of('typing_start').length > 0);
    await sleep(300);
    expect(b.of('typing_start')).toHaveLength(1);
    expect(b.of('typing_start')[0]).toMatchObject({ conversation_id: conv, user_id: alice.id });
    expect(o.of('typing_start')).toHaveLength(0);
  });
});

describe('fastify wiring', () => {
  it('serves Socket.IO from the app and shuts down cleanly', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL ?? '',
      LOG_LEVEL: 'silent',
    });
    const appRedis = createRedis(config.REDIS_URL);
    const app = await buildApp({
      config,
      logger,
      db,
      redis: appRedis,
      checks: [],
      isShuttingDown: () => false,
      authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
    });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = connectClient(address, {
      auth: { token: 'u1', deviceId: randomUUID() },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.close();
    await app.close();
    await appRedis.quit().catch(() => undefined);
  });
});
