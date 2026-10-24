/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access -- test payloads are untyped */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createDb as createMigrationDb, createPool, migrateUp } from '@chat/db';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import type { CallPushJob } from '../../src/modules/gateway/call-push.js';
import { attachGateway } from '../../src/modules/gateway/index.js';
import { createRedis, type Redis } from '../../src/redis.js';
import { closeIo, createIo } from '../../src/ws.js';

// Calls to someone who is offline: the offer is parked in Redis and a push is queued.
// Needs real Postgres and Redis. The token a test client sends IS the user id.
const logger = createLogger('silent');
let db: Db;
let redis: Redis;
let dropDatabase: () => Promise<void>;
let databaseUrl: string;

beforeAll(async () => {
  const adminUrl = process.env.DATABASE_URL ?? '';
  const name = `co_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  databaseUrl = url.toString();
  const pool = createPool({ connectionString: url.toString() });
  await migrateUp(createMigrationDb(pool));
  await pool.end();
  db = createDb(url.toString(), 10);
  redis = createRedis(process.env.REDIS_URL ?? '');
  dropDatabase = async () => {
    await db.destroy();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  };
});
afterAll(async () => {
  await redis.quit().catch(() => undefined);
  await dropDatabase();
});

const stops: (() => Promise<void>)[] = [];
const clients: ClientSocket[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const stop of stops.splice(0)) await stop();
});

/** One API with a fake job queue, so the test can see which pushes would be sent. */
async function startApi(parkedTtlMs = 45_000) {
  const http = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const own = createRedis(process.env.REDIS_URL ?? '');
  const io = createIo(http, own, []);
  const pushes: CallPushJob[] = [];
  const gateway = attachGateway(io, {
    db,
    redis: own,
    logger,
    authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
    enqueueCallPush: (job) => {
      pushes.push(job);
      return Promise.resolve();
    },
    parkedTtlMs,
  });
  stops.push(async () => {
    await gateway.close();
    await closeIo(io);
    await own.quit().catch(() => undefined);
  });
  return { port: (http.address() as AddressInfo).port, pushes, gateway };
}
type Api = Awaited<ReturnType<typeof startApi>>;

async function connect(api: Api, userId: string, deviceId: string) {
  const socket = connectClient(`http://127.0.0.1:${api.port}`, {
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
const ack = (socket: ClientSocket, event: string, payload: unknown) =>
  new Promise<{ ok: boolean }>((resolve) => socket.emit(event, payload, resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check: () => boolean | Promise<boolean>, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for condition');
}

async function makeUser(name: string) {
  const u = await db
    .insertInto('users')
    .values({ username: `u_${randomUUID().replace(/-/g, '').slice(0, 12)}`, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  const d = await db
    .insertInto('devices')
    .values({ user_id: u.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: u.id, device: d.id };
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
const subscribe = (userId: string) =>
  db
    .insertInto('push_subscriptions')
    .values({
      user_id: userId,
      endpoint: `https://push.example/${randomUUID()}`,
      p256dh: 'p',
      auth: 'a',
    })
    .execute();

const sdp = { type: 'offer' as const, sdp: 'v=0' };
const callRow = (callId: string) =>
  db.selectFrom('call_logs').select('status').where('id', '=', callId).executeTakeFirst();

/** Alice (online) calls Bob, who has a push subscription and no connected device. */
async function aliceCallsOfflineBob(api: Api) {
  const alice = await makeUser('Alice');
  const bob = await makeUser('Bob');
  const conv = await makeDirect(alice.id, bob.id);
  await subscribe(bob.id);
  const a = await connect(api, alice.id, alice.device);
  const callId = randomUUID();
  await ack(a.socket, 'call_offer', {
    call_id: callId,
    conversation_id: conv,
    media: 'video',
    sdp,
  });
  return { alice, bob, conv, a, callId };
}

describe('calling someone who is offline', () => {
  it('parks the offer, queues a ring push, and hands the offer over when they connect in time', async () => {
    const api = await startApi();
    const { alice, bob, conv, a, callId } = await aliceCallsOfflineBob(api);

    await eventually(() => api.pushes.length === 1);
    expect(api.pushes[0]).toMatchObject({
      kind: 'ring',
      user_id: bob.id,
      call_id: callId,
      conversation_id: conv,
      caller_name: 'Alice',
      media: 'video',
    });
    expect(api.pushes[0]!.decline_token).toHaveLength(48);
    expect(a.of('call_unavailable')).toHaveLength(0);

    // The caller's candidates arrive while Bob is away; they are kept too.
    await ack(a.socket, 'call_ice', {
      call_id: callId,
      candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 },
    });
    await eventually(async () => (await redis.llen(`call:parked-ice:${bob.id}:${callId}`)) === 1);

    const b = await connect(api, bob.id, bob.device);
    await eventually(() => b.of('call_offer').length > 0);
    expect(b.of('call_offer')[0]).toMatchObject({
      call_id: callId,
      from_user_id: alice.id,
      conversation_id: conv,
      media: 'video',
      sdp,
    });
    await eventually(() => b.of('call_ice').length > 0);
    expect(b.of('call_ice')[0].candidate.candidate).toBe('candidate:1');

    // From here it is an ordinary call: Bob answers and the caller gets the answer.
    await ack(b.socket, 'call_answer', {
      call_id: callId,
      sdp: { type: 'answer', sdp: 'v=0' },
    });
    await eventually(() => a.of('call_answer').length > 0);
    expect(await redis.exists(`call:parked:${bob.id}:${callId}`)).toBe(0); // nothing left parked
    expect(api.pushes.filter((p) => p.kind === 'cancel')).toHaveLength(0);
  });

  it('tells the caller "unreachable" at once when the callee has no push subscription', async () => {
    const api = await startApi();
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const conv = await makeDirect(alice.id, bob.id);
    const a = await connect(api, alice.id, alice.device);
    const callId = randomUUID();
    await ack(a.socket, 'call_offer', {
      call_id: callId,
      conversation_id: conv,
      media: 'audio',
      sdp,
    });
    await eventually(() => a.of('call_unavailable').length > 0);
    expect(a.of('call_unavailable')[0]).toEqual({ call_id: callId, reason: 'unreachable' });
    expect(api.pushes).toHaveLength(0);
    expect(await redis.exists(`call:parked:${bob.id}:${callId}`)).toBe(0);
  });

  it('ignores a push subscription that was switched off', async () => {
    const api = await startApi();
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const conv = await makeDirect(alice.id, bob.id);
    await subscribe(bob.id);
    await db
      .updateTable('push_subscriptions')
      .set({ disabled_at: new Date() })
      .where('user_id', '=', bob.id)
      .execute();
    const a = await connect(api, alice.id, alice.device);
    await ack(a.socket, 'call_offer', {
      call_id: randomUUID(),
      conversation_id: conv,
      media: 'audio',
      sdp,
    });
    await eventually(() => a.of('call_unavailable').length > 0);
    expect(a.of('call_unavailable')[0].reason).toBe('unreachable');
  });

  it('when the caller cancels: clears the offer, sends a cancel push, logs a missed call', async () => {
    const api = await startApi();
    const { bob, a, callId } = await aliceCallsOfflineBob(api);
    await eventually(() => api.pushes.length === 1);

    await ack(a.socket, 'call_end', { call_id: callId, reason: 'hangup' });
    await eventually(() => api.pushes.length === 2);
    expect(api.pushes[1]).toMatchObject({ kind: 'cancel', user_id: bob.id, call_id: callId });
    expect(await redis.exists(`call:parked:${bob.id}:${callId}`)).toBe(0);
    await eventually(async () => (await callRow(callId))?.status === 'missed');

    // Bob opens the app afterwards: there is nothing to ring.
    const b = await connect(api, bob.id, bob.device);
    await sleep(300);
    expect(b.of('call_offer')).toHaveLength(0);
  });

  it('when the window passes: ends the call for the caller, cancels the push, logs a missed call', async () => {
    const api = await startApi(400);
    const { bob, a, callId } = await aliceCallsOfflineBob(api);
    await eventually(() => api.pushes.length === 1);

    await eventually(() => a.of('call_end').length > 0);
    expect(a.of('call_end')[0]).toMatchObject({ call_id: callId, reason: 'timeout' });
    await eventually(() => api.pushes.length === 2);
    expect(api.pushes[1]).toMatchObject({ kind: 'cancel', user_id: bob.id });
    await eventually(async () => (await callRow(callId))?.status === 'missed');

    const b = await connect(api, bob.id, bob.device);
    await sleep(300);
    expect(b.of('call_offer')).toHaveLength(0);
  });

  it('does not deliver an offer whose window passed, even before the timer ran', async () => {
    const api = await startApi(300);
    const { bob } = await aliceCallsOfflineBob(api);
    await sleep(350); // the parked offer has expired in Redis
    const b = await connect(api, bob.id, bob.device);
    await sleep(300);
    expect(b.of('call_offer')).toHaveLength(0);
  });

  it('lets the callee decline from the notification with the one-time token', async () => {
    const api = await startApi();
    const { bob, a, callId } = await aliceCallsOfflineBob(api);
    await eventually(() => api.pushes.length === 1);
    const token = api.pushes[0]!.decline_token!;

    expect(await api.gateway.calls.declineFromPush(callId, 'x'.repeat(48))).toBe(false);
    expect(await api.gateway.calls.declineFromPush(randomUUID(), token)).toBe(false);
    expect(await api.gateway.calls.declineFromPush(callId, token)).toBe(true);

    await eventually(() => a.of('call_reject').length > 0);
    expect(a.of('call_reject')[0]).toMatchObject({ call_id: callId, from_user_id: bob.id });
    await eventually(async () => (await callRow(callId))?.status === 'rejected');
    // The token works once: the call is gone.
    expect(await api.gateway.calls.declineFromPush(callId, token)).toBe(false);
  });

  it('keeps ringing a callee who is online as before, with no push', async () => {
    const api = await startApi();
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const conv = await makeDirect(alice.id, bob.id);
    await subscribe(bob.id);
    const a = await connect(api, alice.id, alice.device);
    const b = await connect(api, bob.id, bob.device);
    await ack(a.socket, 'call_offer', {
      call_id: randomUUID(),
      conversation_id: conv,
      media: 'audio',
      sdp,
    });
    await eventually(() => b.of('call_offer').length > 0);
    expect(api.pushes).toHaveLength(0);
  });
});

describe('the real app wiring (job queue and the decline route)', () => {
  it('queues the ring in pg-boss for the worker, and the decline route needs the right token', async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: process.env.REDIS_URL,
      LOG_LEVEL: 'silent',
    });
    const app = await buildApp({
      config,
      logger,
      db,
      redis,
      checks: [],
      isShuttingDown: () => false,
      authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    stops.push(() => app.close());
    const port = (app.server.address() as AddressInfo).port;

    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const conv = await makeDirect(alice.id, bob.id);
    await subscribe(bob.id);
    const a = await connect({ port } as Api, alice.id, alice.device);
    const callId = randomUUID();
    await ack(a.socket, 'call_offer', {
      call_id: callId,
      conversation_id: conv,
      media: 'audio',
      sdp,
    });

    // What the worker would receive.
    const boss = new PgBoss({
      connectionString: databaseUrl,
      max: 2,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    stops.push(() => boss.stop({ graceful: false }));
    let job: CallPushJob | undefined;
    await eventually(async () => {
      const jobs = await boss.fetch<CallPushJob>('call-push');
      job = jobs[0]?.data;
      return job !== undefined;
    });
    expect(job).toMatchObject({
      kind: 'ring',
      user_id: bob.id,
      call_id: callId,
      caller_name: 'Alice',
    });

    const decline = (token: string, id = callId) =>
      app.inject({
        method: 'POST',
        url: '/calls/decline-from-push',
        payload: { call_id: id, token },
      });
    expect((await decline('x'.repeat(48))).statusCode).toBe(404); // wrong token
    expect((await decline('short')).statusCode).toBe(400); // not even a token
    expect((await decline(job!.decline_token!)).statusCode).toBe(204);
    await eventually(() => a.of('call_reject').length > 0);
    expect((await decline(job!.decline_token!)).statusCode).toBe(404); // used up with the call
  });
});
