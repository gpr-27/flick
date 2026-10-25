/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { execFileSync } from 'node:child_process';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createServer, type Server as HttpServer } from 'node:http';
import { allocateSeqAndInsertMessage, createPool } from '@chat/db';
import { Kysely, PostgresDialect } from 'kysely';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import type { Database } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { createDispatcher, NOTIFY_QUEUE } from '../../src/modules/dispatcher/index.js';
import { attachGateway } from '../../src/modules/gateway/index.js';
import { createRedis } from '../../src/redis.js';
import { closeIo, createIo } from '../../src/ws.js';
import {
  connectSocket,
  createDatabase,
  direct,
  group,
  send,
  startStack,
  waitForOutboxDrained,
  waitUntil,
  type Client,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// FAILURE INJECTION.
//
//  (a) Redis dies while the API is running (a real throwaway Redis container is stopped and
//      started again): a send still commits, and everything is recovered afterwards.
//  (b) A Postgres connection is killed in the middle of a dispatch round: the outbox row stays,
//      the next round sends it again, and clients drop the repeat by seq.
//  (c) Two dispatcher replicas share one outbox: what order do clients see?
//
// What these results mean is written up in docs/testing.md.

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const dockerAvailable = (() => {
  try {
    docker('version', '--format', '{{.Server.Version}}');
    docker('image', 'inspect', 'redis:7-alpine');
    return true;
  } catch {
    return false;
  }
})();

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logger = createLogger('silent');

/** A user and the seq-ordered list of what the client application would hold (dedupe by seq). */
const heldSeqs = (client: Client) =>
  [...new Set(client.messages().map((m) => m.seq as number))].sort((a, b) => a - b);

let database: TestDatabase;
beforeAll(async () => {
  database = await createDatabase('fail');
});
afterAll(async () => {
  await database.drop();
});

// ====================================================================== (a) Redis down

describe.skipIf(!dockerAvailable)('(a) Redis goes down while the API is running', () => {
  const name = `flick-bt-redis-${String(process.pid)}`;
  let port: number;
  let stack: Stack;
  let alice: TestUser;
  let bob: TestUser;
  let conv: string;
  let bobLive: Client;
  let aliceLive: Client;

  const redisCli = (...args: string[]) => docker('exec', name, 'redis-cli', ...args);

  beforeAll(async () => {
    port = await freePort();
    docker(
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `127.0.0.1:${String(port)}:6379`,
      'redis:7-alpine',
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    );
    await waitUntil(
      () => {
        try {
          return redisCli('ping') === 'PONG';
        } catch {
          return false;
        }
      },
      20_000,
      'the throwaway Redis',
    );
    stack = await startStack({
      databaseUrl: database.url,
      redisUrl: `redis://127.0.0.1:${String(port)}`,
    });
    [alice, bob] = await Promise.all([stack.user('alice'), stack.user('bob')]);
    conv = await direct(stack, alice, bob);
    bobLive = await stack.connect(bob);
    aliceLive = await stack.connect(alice);
  });
  afterAll(async () => {
    await stack?.stop();
    try {
      docker('rm', '-f', name);
    } catch {
      // already gone
    }
  });

  const outageSeqs: number[] = [];

  it('works while Redis is up (the baseline)', async () => {
    const res = await send(stack, alice, conv, { type: 'text', text: 'before the outage' });
    expect(res.status).toBe(200);
    await waitUntil(
      () => bobLive.messages().some((m) => m.message_id === res.body.message_id),
      8_000,
      'live delivery',
    );
  });

  it('REST and Socket.IO sends commit while Redis is down, quickly, and reads keep working', async () => {
    docker('stop', '-t', '0', name);
    await sleep(300);

    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const res = await send(stack, alice, conv, {
        type: 'text',
        text: `during the outage ${String(i)}`,
      });
      timings.push(Date.now() - t0);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      outageSeqs.push(res.body.seq);
    }
    // a send must not wait for a dead Redis
    expect(
      Math.max(...timings),
      `send latencies during the outage: ${timings.join(', ')} ms`,
    ).toBeLessThan(5_000);

    const ack = await aliceLive.emit('send_message', {
      conversation_id: conv,
      client_message_id: `outage-socket-${String(Date.now())}`,
      content: { type: 'text', text: 'socket send during the outage' },
    });
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    outageSeqs.push(ack.data.seq);

    // everything that reads only Postgres keeps working
    const history = await stack.call(bob, 'GET', `/conversations/${conv}/messages?limit=100`);
    expect(history.status).toBe(200);
    expect(history.body.items.length).toBeGreaterThanOrEqual(7);
    const list = await stack.call(bob, 'GET', '/conversations');
    expect(list.status).toBe(200);
    const edit = await stack.call(alice, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: outageSeqs[0] }],
    });
    expect(edit.status).toBe(204);

    // the rows are committed, with dense seqs, and their outbox rows are there to be sent later
    const rows = await stack.db
      .selectFrom('messages')
      .select('seq')
      .where('conversation_id', '=', conv)
      .orderBy('seq')
      .execute();
    const seqs = rows.map((r) => Number(r.seq));
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('a sync during the outage returns every message (sync is the recovery path)', async () => {
    const sync = await stack.call(bob, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 1 }],
      limit: 100,
    });
    expect(sync.status).toBe(200);
    const seqs = sync.body.events
      .filter((e: any) => e.type === 'new_message')
      .map((e: any) => e.payload.message.seq);
    for (const seq of outageSeqs) expect(seqs).toContain(seq);
  });

  it('the HTTP rate limiter fails open: requests are not refused because Redis is gone', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => stack.call(alice, 'GET', '/users/me')),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200)); // never a 429 or a 5xx from the limiter
  });

  it('after Redis comes back, new messages are delivered live again and sync fills in what was missed', async () => {
    docker('start', name);
    await waitUntil(
      () => {
        try {
          return redisCli('ping') === 'PONG';
        } catch {
          return false;
        }
      },
      20_000,
      'Redis to come back',
    );
    // ioredis reconnects and the Socket.IO adapter resubscribes on its own
    await sleep(2_500);
    const res = await send(stack, alice, conv, { type: 'text', text: 'after the outage' });
    expect(res.status).toBe(200);
    await waitUntil(
      () => bobLive.messages().some((m) => m.message_id === res.body.message_id),
      20_000,
      'live delivery after Redis is back',
    );

    // Whatever the live path missed, sync returns it: the client's view after sync is complete.
    const after = heldSeqs(bobLive);
    const sync = await stack.call(bob, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 200,
    });
    const synced = sync.body.events
      .filter((e: any) => e.type === 'new_message')
      .map((e: any) => e.payload.message.seq as number);
    const union = [...new Set([...after, ...synced])].sort((a, b) => a - b);
    const total = (
      await stack.db
        .selectFrom('messages')
        .select('seq')
        .where('conversation_id', '=', conv)
        .execute()
    ).length;
    expect(union).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it('the outbox is not left holding rows after recovery (published, or dropped after repeated failures and left to sync)', async () => {
    await waitForOutboxDrained(stack.db, 120_000);
    const stuck = await stack.db
      .selectFrom('outbox')
      .select('id')
      .where('published_at', 'is', null)
      .execute();
    expect(stuck).toEqual([]);
  });
});

// ====================================================================== replicas

interface Replica {
  port: number;
  dispatcher: ReturnType<typeof createDispatcher>;
  pool: ReturnType<typeof createPool>;
  stop(): Promise<void>;
}

/** One API replica made of its parts, so a test can hold one of them back or break its database. */
async function startReplica(options: {
  databaseUrl: string;
  applicationName: string;
  dispatch: boolean;
  sendJob?: (queue: string, data: object, opts: object) => Promise<unknown>;
  onMessageCreated?: () => void;
}): Promise<Replica> {
  const redis = createRedis(process.env.REDIS_URL ?? '');
  redis.on('error', () => undefined);
  const http: HttpServer = createServer();
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const io = createIo(http, redis, []);
  const pool = createPool({
    connectionString: options.databaseUrl,
    max: 10,
    application_name: options.applicationName,
  });
  pool.on('error', () => undefined);
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  const gateway = attachGateway(io, {
    db,
    redis,
    logger,
    authenticateSocket: (token, deviceId) => Promise.resolve({ userId: token, deviceId }),
  });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: options.databaseUrl,
    REDIS_URL: 'redis://x',
  });
  const boss = options.sendJob
    ? ({ send: options.sendJob } as unknown as PgBoss)
    : (() => {
        const real = new PgBoss({
          connectionString: options.databaseUrl,
          max: 2,
          supervise: false,
          schedule: false,
        });
        real.on('error', () => undefined);
        return real;
      })();
  if (!options.sendJob) {
    await boss.start();
    await boss.createQueue(NOTIFY_QUEUE);
  }
  const dispatcher = createDispatcher({
    db,
    io,
    config,
    boss,
    logger,
    pollMs: 30,
    ...(options.onMessageCreated ? { onMessageCreated: options.onMessageCreated } : {}),
  });
  if (options.dispatch) dispatcher.start();
  return {
    port: (http.address() as AddressInfo).port,
    dispatcher,
    pool,
    async stop() {
      await dispatcher.stop();
      await gateway.close();
      await closeIo(io);
      if (!options.sendJob) await boss.stop({ graceful: false }).catch(() => undefined);
      await db.destroy().catch(() => undefined);
      redis.disconnect();
    },
  };
}

async function adminQuery(sqlText: string) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: database.url });
  await c.connect();
  try {
    return await c.query(sqlText);
  } finally {
    await c.end();
  }
}

/** Inserts `count` committed messages from `sender` straight into the database, ids ascending. */
async function insertMessages(
  db: Kysely<Database>,
  conversationId: string,
  sender: TestUser,
  count: number,
  prefix: string,
) {
  for (let i = 0; i < count; i++) {
    await allocateSeqAndInsertMessage(db, {
      conversationId,
      senderId: sender.id,
      senderDeviceId: sender.deviceId,
      clientMessageId: `${prefix}-${String(i).padStart(4, '0')}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'text',
      bodyText: `${prefix} ${String(i)}`,
    });
  }
}

// ====================================================================== (b) Postgres connection drop

describe('(b) a Postgres connection is killed in the middle of a dispatch round', () => {
  it('the outbox rows survive, are sent again by the next round, and the client holds every message once', async () => {
    const stack = await startStack({ databaseUrl: database.url });
    const [alice, bob] = await Promise.all([stack.user('alice'), stack.user('bob')]);
    const conv = await direct(stack, alice, bob);
    await waitForOutboxDrained(stack.db); // the conversation-created event of the helper above
    await stack.stop(); // keep only the data; the replica below does the dispatching

    let killed = 0;
    const killDispatcher = async () => {
      // terminate the backend that holds the claiming transaction (it is idle in transaction while emitting)
      const res = await adminQuery(
        `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE application_name = 'dispatcher-under-test' AND state IN ('idle in transaction', 'active') AND pid <> pg_backend_pid()`,
      );
      killed += res.rows.filter((r) => r.ok).length;
    };

    // seed 12 committed messages while no dispatcher runs, so one round claims them all
    const seedPool = createPool({ connectionString: database.url, max: 2 });
    seedPool.on('error', () => undefined);
    const seedDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool: seedPool }) });
    await insertMessages(seedDb, conv, alice, 12, 'drop');

    const replica = await startReplica({
      databaseUrl: database.url,
      applicationName: 'dispatcher-under-test',
      dispatch: false,
      // runs right after the first message of the round was emitted, before the round commits
      onMessageCreated: (() => {
        let first = true;
        return () => {
          if (first) {
            first = false;
            void killDispatcher();
          }
        };
      })(),
    });
    const bobClient = await connectSocket(replica.port, bob);
    // the round fails when its connection dies; runOnce throws, the loop logs and backs off
    replica.dispatcher.start();

    await waitUntil(() => killed > 0, 15_000, 'the connection to be killed');
    await waitUntil(
      async () => {
        const left = await seedDb
          .selectFrom('outbox')
          .select('id')
          .where('published_at', 'is', null)
          .where('topic', '=', 'chat.message.v1')
          .execute();
        return left.length === 0;
      },
      60_000,
      'every outbox row to be published after the retry',
    );
    await waitUntil(() => heldSeqs(bobClient).length >= 12, 20_000, 'bob to hold all 12');

    // nothing lost, nothing double for the client that dedupes by seq
    expect(heldSeqs(bobClient)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // at-least-once: the message emitted before the kill was emitted again (a repeat of a seq is allowed, a gap is not)
    const arrivals = bobClient.messages().map((m) => m.seq as number);
    expect(arrivals.length).toBeGreaterThanOrEqual(12);
    expect(arrivals.length, 'the repeat is the retry of the killed round').toBeGreaterThan(12);
    // the rows in the database are untouched by the failure
    const rows = await seedDb
      .selectFrom('messages')
      .select('seq')
      .where('conversation_id', '=', conv)
      .execute();
    expect(rows).toHaveLength(12);
    const attempts = await seedDb
      .selectFrom('outbox')
      .select(['attempts', 'published_at'])
      .where('topic', '=', 'chat.message.v1')
      .execute();
    expect(attempts.every((r) => r.published_at !== null)).toBe(true);

    bobClient.close();
    await replica.stop();
    await seedDb.destroy();
  });

  it('a pool that lost all its connections recovers on its own: the next sends and dispatches work', async () => {
    const stack = await startStack({ databaseUrl: database.url });
    const [alice, bob] = await Promise.all([stack.user('alice'), stack.user('bob')]);
    const conv = await direct(stack, alice, bob);
    const live = await stack.connect(bob);
    const first = await send(stack, alice, conv, { type: 'text', text: 'before the drop' });
    await waitUntil(
      () => live.messages().some((m) => m.message_id === first.body.message_id),
      8_000,
      'first message',
    );

    // cut every connection the API has to Postgres
    await adminQuery(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'chat-api' AND datname = current_database() AND pid <> pg_backend_pid()`,
    );
    await sleep(300);

    // a request that hits a dead pooled connection may fail once; retrying (what the client outbox does) must succeed
    let second: Awaited<ReturnType<typeof send>> | undefined;
    for (let attempt = 0; attempt < 5 && second?.status !== 200; attempt++) {
      second = await stack.call(alice, 'POST', `/conversations/${conv}/messages`, {
        client_message_id: 'retry-after-drop-1',
        content: { type: 'text', text: 'after the drop' },
      });
      if (second.status !== 200) await sleep(200);
    }
    expect(second?.status, JSON.stringify(second?.body)).toBe(200);
    await waitUntil(
      () => live.messages().some((m) => m.message_id === second!.body.message_id),
      20_000,
      'delivery after the drop',
    );
    // and the retried id is still idempotent
    const again = await stack.call(alice, 'POST', `/conversations/${conv}/messages`, {
      client_message_id: 'retry-after-drop-1',
      content: { type: 'text', text: 'after the drop' },
    });
    expect(again.body.duplicate).toBe(true);
    expect(heldSeqs(live)).toEqual([1, 2]);
    await stack.stop();
  });
});

// ====================================================================== (c) two dispatchers

describe('(c) two dispatcher replicas on one outbox', () => {
  async function conversationWithBacklog(count: number) {
    const stack = await startStack({ databaseUrl: database.url });
    const [alice, bob, carol] = await Promise.all([
      stack.user('alice'),
      stack.user('bob'),
      stack.user('carol'),
    ]);
    const conv = await group(stack, alice, [bob, carol]);
    await waitForOutboxDrained(stack.db);
    const seedPool = createPool({ connectionString: database.url, max: 2 });
    seedPool.on('error', () => undefined);
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: seedPool }) });
    await stack.stop();
    await insertMessages(db, conv, alice, count, 'backlog');
    return { alice, bob, carol, conv, db };
  }

  it('one dispatcher emits one conversation strictly in seq order', async () => {
    const { bob, conv, db } = await conversationWithBacklog(250);
    const replica = await startReplica({
      databaseUrl: database.url,
      applicationName: 'solo',
      dispatch: false,
      sendJob: () => Promise.resolve(),
    });
    const bobClient = await connectSocket(replica.port, bob);
    replica.dispatcher.start();
    await waitUntil(() => heldSeqs(bobClient).length >= 250, 30_000, '250 live messages');
    const arrival = bobClient
      .messages()
      .filter((m) => m.conversation_id === conv)
      .map((m) => m.seq as number);
    expect(arrival).toEqual([...arrival].sort((a, b) => a - b));
    expect(new Set(arrival).size).toBe(arrival.length);
    bobClient.close();
    await replica.stop();
    await db.destroy();
  });

  it('two dispatchers split the backlog (SKIP LOCKED): every row is emitted, none is claimed by both', async () => {
    const { bob, conv, db } = await conversationWithBacklog(300);
    const a = await startReplica({
      databaseUrl: database.url,
      applicationName: 'replica-a',
      dispatch: false,
      sendJob: () => Promise.resolve(),
    });
    const b = await startReplica({
      databaseUrl: database.url,
      applicationName: 'replica-b',
      dispatch: false,
      sendJob: () => Promise.resolve(),
    });
    const bobClient = await connectSocket(a.port, bob);
    a.dispatcher.start();
    b.dispatcher.start();
    await waitUntil(() => heldSeqs(bobClient).length >= 300, 40_000, '300 live messages');
    await waitForOutboxDrained(db);
    const arrival = bobClient
      .messages()
      .filter((m) => m.conversation_id === conv)
      .map((m) => m.seq as number);
    // nothing is lost; a repeat can happen only if a round was retried, never because both claimed one row
    expect(new Set(arrival).size).toBe(300);
    expect(arrival.length).toBe(300);
    bobClient.close();
    await a.stop();
    await b.stop();
    await db.destroy();
  });

  it('LIVE ORDER ACROSS REPLICAS IS NOT GUARANTEED: a slow replica holding the oldest batch lets a faster one deliver later seqs first, and sync repairs it', async () => {
    const { bob, carol, conv, db } = await conversationWithBacklog(220);
    // carol has no socket, so every row also queues a notify job; replica A's job queue is slow
    const slowSend = async () => {
      await sleep(15);
    };
    const slow = await startReplica({
      databaseUrl: database.url,
      applicationName: 'slow',
      dispatch: false,
      sendJob: slowSend,
    });
    const fast = await startReplica({
      databaseUrl: database.url,
      applicationName: 'fast',
      dispatch: false,
      sendJob: () => Promise.resolve(),
    });
    const bobClient = await connectSocket(fast.port, bob);
    void carol;
    slow.dispatcher.start();
    await sleep(60); // the slow replica is now inside its first batch of 100 (the oldest rows)
    fast.dispatcher.start();
    await waitUntil(() => heldSeqs(bobClient).length >= 220, 60_000, '220 live messages');

    const arrival = bobClient
      .messages()
      .filter((m) => m.conversation_id === conv)
      .map((m) => m.seq as number);
    const outOfOrder = arrival.some((seq, i) => i > 0 && seq < Math.max(...arrival.slice(0, i)));
    // Documented behaviour (ADR-0004, docs/testing.md): with two dispatchers a later batch can overtake an earlier one.
    // If the dispatcher is ever changed to keep one conversation in order across replicas, replace this
    // assertion with `expect(arrival).toEqual([...arrival].sort((a, b) => a - b))` and update the docs.
    expect(outOfOrder, 'two replicas overtook each other').toBe(true);

    // ...and it is repaired: nothing is missing, a client that sorts and dedupes by seq holds the exact history,
    // and a sync from any point returns the missing range in order.
    // (seq 1 is the "group created" line, delivered before bob connected; the backlog is seqs 2..221)
    const expected = Array.from({ length: 220 }, (_, i) => i + 2);
    expect(heldSeqs(bobClient)).toEqual(expected);
    const stack = await startStack({ databaseUrl: database.url });
    const sync = await stack.call(bob, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 1 }],
      limit: 500,
    });
    expect(sync.body.events.map((e: any) => e.payload.message.seq as number)).toEqual(expected);
    await stack.stop();
    bobClient.close();
    await slow.stop();
    await fast.stop();
    await db.destroy();
  });
});
