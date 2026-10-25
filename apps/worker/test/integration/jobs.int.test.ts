import { randomUUID } from 'node:crypto';
import { createDb, createPool, migrateUp, type Database } from '@chat/db';
import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import { PgBoss } from 'pg-boss';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startJobs, stopJobs } from '../../src/jobs/boss.js';
import { expireMessages } from '../../src/jobs/expire-messages.js';
import {
  CANCEL_OPTIONS,
  RING_OPTIONS,
  handleCallPush,
  type CallPushJob,
} from '../../src/jobs/call-push.js';
import { NOTIFY_QUEUE, handleNotify } from '../../src/jobs/notify.js';
import { sweepUploads } from '../../src/jobs/sweep-uploads.js';
import { createLogger } from '../../src/logger.js';
import {
  emptySummary,
  type Notification,
  type NotificationProvider,
} from '../../src/notifications.js';
import { type PushSender } from '../../src/web-push-provider.js';

// Needs real Postgres and Redis (DATABASE_URL, REDIS_URL). Each run gets its own database.
const logger = createLogger('silent');
let url: string;
let pool: pg.Pool;
let db: Kysely<Database>;
let redis: Redis;

beforeAll(async () => {
  const name = `w_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${name}`;
  url = u.toString();
  pool = createPool({ connectionString: url });
  db = createDb(pool);
  await migrateUp(db);
  redis = new Redis(process.env.REDIS_URL!);
});

afterAll(async () => {
  await db.destroy();
  await redis.quit();
});

async function makeUser(name: string): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ username: `${name}_${randomUUID().slice(0, 6)}`, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** A group with the given members and `count` text messages from the first member (seq 1..count). */
async function makeChat(members: string[], count: number) {
  const conversation = await db
    .insertInto('conversations')
    .values({ type: 'group', name: 'Team', last_seq: count })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(members.map((user_id) => ({ conversation_id: conversation.id, user_id })))
    .execute();
  const messageIds: string[] = [];
  for (let seq = 1; seq <= count; seq++) {
    const m = await db
      .insertInto('messages')
      .values({
        conversation_id: conversation.id,
        seq,
        sender_id: members[0]!,
        type: 'text',
        body_text: `hello ${seq}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    messageIds.push(m.id);
  }
  return { conversationId: conversation.id, messageIds };
}

const recorder = () => {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    send: (n) => {
      sent.push(n);
      return Promise.resolve(emptySummary());
    },
  };
  return { sent, provider };
};

describe('expire-messages', () => {
  it('turns expired messages into tombstones and keeps every seq', async () => {
    const alice = await makeUser('alice');
    const { conversationId, messageIds } = await makeChat([alice], 3);
    await db
      .updateTable('messages')
      .set({ expire_at: new Date(Date.now() - 1000) })
      .where('id', '=', messageIds[1]!)
      .execute();

    const result = await expireMessages(db);
    expect(result.expired).toBe(1);

    const rows = await db
      .selectFrom('messages')
      .select(['seq', 'body_text', 'deleted_at'])
      .where('conversation_id', '=', conversationId)
      .orderBy('seq')
      .execute();
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]); // no gap, so sync stays continuous
    expect(rows[1]).toMatchObject({ body_text: null });
    expect(rows[1]!.deleted_at).not.toBeNull();
    expect(rows[0]!.body_text).toBe('hello 1'); // others untouched
    expect(rows[2]!.deleted_at).toBeNull();
  });
});

describe('notify', () => {
  it('runs through a real pg-boss queue', async () => {
    const [alice, bob] = await Promise.all([makeUser('alice'), makeUser('bob')]);
    const { conversationId, messageIds } = await makeChat([alice, bob], 1);
    const { sent, provider } = recorder();
    const boss = new PgBoss(url);
    await startJobs({
      boss,
      db,
      logger,
      notify: { db, provider },
      callPush: { db, redis, sender: null, logger },
      storage: undefined,
    });
    try {
      await boss.send(NOTIFY_QUEUE, {
        user_id: bob,
        conversation_id: conversationId,
        message_id: messageIds[0],
        seq: 1,
      });
      await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 15_000 });
    } finally {
      await stopJobs(boss);
    }
  });
});

describe('sweep-uploads', () => {
  it('removes old pending uploads (object and row) and leaves the rest', async () => {
    const owner = await makeUser('gina');
    const insert = (status: 'pending' | 'uploaded', ageHours: number) =>
      db
        .insertInto('attachments')
        .values({
          owner_id: owner,
          object_key: `sweep/${randomUUID()}`,
          declared_mime: 'image/png',
          size_bytes: 10,
          status,
          sha256: status === 'pending' ? null : Buffer.alloc(32),
          created_at: new Date(Date.now() - ageHours * 3_600_000),
        })
        .returning(['id', 'object_key'])
        .executeTakeFirstOrThrow();
    const oldPending = await insert('pending', 48);
    const freshPending = await insert('pending', 1);
    const oldUploaded = await insert('uploaded', 48);

    const deleted: string[] = [];
    const client = {
      send: (command: { input: { Key?: string } }) => {
        deleted.push(command.input.Key!);
        return Promise.resolve({});
      },
    } as never;

    expect(await sweepUploads(db, { client, bucket: 'b' })).toBeGreaterThanOrEqual(1);
    expect(deleted).toContain(oldPending.object_key);
    expect(deleted).not.toContain(freshPending.object_key);
    expect(deleted).not.toContain(oldUploaded.object_key);

    const left = await db
      .selectFrom('attachments')
      .select('id')
      .where('id', 'in', [oldPending.id, freshPending.id, oldUploaded.id])
      .execute();
    expect(left.map((r) => r.id).sort()).toEqual([freshPending.id, oldUploaded.id].sort());
  });
});

describe('call push', () => {
  const sent: { endpoint: string; payload: Record<string, unknown>; options: unknown }[] = [];
  const sender: PushSender = (target, payload, options) => {
    sent.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as Record<string, unknown>,
      options,
    });
    return Promise.resolve();
  };
  const job = (user_id: string, kind: 'ring' | 'cancel'): CallPushJob => ({
    kind,
    user_id,
    call_id: randomUUID(),
    conversation_id: randomUUID(),
    caller_name: 'Praneeth',
    media: 'video',
    ...(kind === 'ring' ? { decline_token: 'tok' } : {}),
  });
  const park = (j: CallPushJob) =>
    redis.set(`call:parked:${j.user_id}:${j.call_id}`, '{}', 'EX', 30);

  it('rings every subscription with a short, high-urgency push, only while the call is parked', async () => {
    sent.length = 0;
    const bob = await makeUser('bob');
    await db
      .insertInto('push_subscriptions')
      .values([
        { user_id: bob, endpoint: `https://push.example/${randomUUID()}`, p256dh: 'p', auth: 'a' },
        { user_id: bob, endpoint: `https://push.example/${randomUUID()}`, p256dh: 'p', auth: 'a' },
      ])
      .execute();
    const deps = { db, redis, sender, logger };
    const ring = job(bob, 'ring');

    // The call was already cancelled or expired when the job ran: nothing is sent.
    expect(await handleCallPush(deps, ring)).toBe('skipped_expired');
    expect(sent).toHaveLength(0);

    await park(ring);
    expect(await handleCallPush(deps, ring)).toBe('sent');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      payload: {
        type: 'call',
        call_id: ring.call_id,
        caller_name: 'Praneeth',
        media: 'video',
        decline_token: 'tok',
      },
      options: RING_OPTIONS,
    });
    expect(RING_OPTIONS).toEqual({ ttlSeconds: 30, urgency: 'high' });
  });

  it('does not ring someone who came online meanwhile (the app rings itself)', async () => {
    sent.length = 0;
    const bob = await makeUser('bob');
    const ring = job(bob, 'ring');
    await park(ring);
    await redis.zadd(`presence:user:${bob}`, Date.now() + 60_000, randomUUID());
    expect(await handleCallPush({ db, redis, sender, logger }, ring)).toBe('skipped_online');
    expect(sent).toHaveLength(0);
  });

  it('always sends the cancel, as a not-urgent push that outlives the ring', async () => {
    sent.length = 0;
    const bob = await makeUser('bob');
    await db
      .insertInto('push_subscriptions')
      .values({
        user_id: bob,
        endpoint: `https://push.example/${randomUUID()}`,
        p256dh: 'p',
        auth: 'a',
      })
      .execute();
    const cancel = job(bob, 'cancel'); // nothing parked any more
    expect(await handleCallPush({ db, redis, sender, logger }, cancel)).toBe('sent');
    expect(sent[0]).toMatchObject({
      payload: { type: 'call_cancel', call_id: cancel.call_id },
      options: CANCEL_OPTIONS,
    });
    expect(sent[0]!.payload.decline_token).toBeUndefined();
  });

  it('only logs when there are no VAPID keys, and sends nothing', async () => {
    const bob = await makeUser('bob');
    const cancel = job(bob, 'cancel');
    expect(await handleCallPush({ db, redis, sender: null, logger }, cancel)).toBe('simulated');
  });

  it('disables a subscription the push service says is gone', async () => {
    const bob = await makeUser('bob');
    const endpoint = `https://push.example/${randomUUID()}`;
    await db
      .insertInto('push_subscriptions')
      .values({ user_id: bob, endpoint, p256dh: 'p', auth: 'a' })
      .execute();
    const gone: PushSender = () =>
      Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }));
    await handleCallPush({ db, redis, sender: gone, logger }, job(bob, 'cancel'));
    const row = await db
      .selectFrom('push_subscriptions')
      .select('disabled_at')
      .where('endpoint', '=', endpoint)
      .executeTakeFirstOrThrow();
    expect(row.disabled_at).not.toBeNull();
  });
});
