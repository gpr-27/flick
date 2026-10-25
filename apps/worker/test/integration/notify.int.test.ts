import { randomUUID } from 'node:crypto';
import { createDb, createPool, migrateUp, type Database } from '@chat/db';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleNotify, type NotifyJob } from '../../src/jobs/notify.js';
import { purgeOldNotifications } from '../../src/jobs/purge-notifications.js';
import { WebPushNotificationProvider, type PushSender } from '../../src/web-push-provider.js';

// The notify job end to end with a FAKE push sender: the real database, no push service.
let db: Kysely<Database>;
beforeAll(async () => {
  const name = `n_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${name}`;
  db = createDb(createPool({ connectionString: u.toString() }));
  await migrateUp(db);
});
afterAll(async () => {
  await db.destroy();
});

const makeUser = async (name: string): Promise<string> =>
  (
    await db
      .insertInto('users')
      .values({ username: `${name}_${randomUUID().slice(0, 6)}`, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;

/** A device row (a sign-in), optionally with a push subscription. */
async function makeDevice(userId: string, withPush = true) {
  const device = await db
    .insertInto('devices')
    .values({ user_id: userId, name: 'phone', platform: 'web' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const endpoint = `https://push.example/${randomUUID()}`;
  if (withPush)
    await db
      .insertInto('push_subscriptions')
      .values({ user_id: userId, device_id: device.id, endpoint, p256dh: 'p', auth: 'a' })
      .execute();
  return { deviceId: device.id, endpoint };
}

interface ChatOptions {
  group?: boolean;
  type?: 'text' | 'image' | 'voice';
  body?: string | null;
  mentions?: string[];
}

/** A chat where the first member sends one message (seq 1). */
async function makeChat(members: string[], options: ChatOptions = {}) {
  const conversation = await db
    .insertInto('conversations')
    .values({
      type: options.group ? 'group' : 'direct',
      name: options.group ? 'Team' : null,
      last_seq: 1,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(members.map((user_id) => ({ conversation_id: conversation.id, user_id })))
    .execute();
  const message = await db
    .insertInto('messages')
    .values({
      conversation_id: conversation.id,
      seq: 1,
      sender_id: members[0]!,
      type: options.type ?? 'text',
      body_text: options.body === undefined ? 'hello there' : options.body,
      mentions: options.mentions ?? [],
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { conversationId: conversation.id, messageId: message.id };
}

const jobFor = (
  userId: string,
  chat: { conversationId: string; messageId: string },
  kind?: NotifyJob['kind'],
): NotifyJob => ({
  user_id: userId,
  conversation_id: chat.conversationId,
  message_id: chat.messageId,
  seq: 1,
  kind,
});

const fakeSender = (failing: Record<string, number> = {}, now?: Date) => {
  const calls: { endpoint: string; payload: Record<string, unknown>; urgency?: string }[] = [];
  const sender = vi.fn<PushSender>((target, payload, options) => {
    const status = failing[target.endpoint];
    if (status)
      return Promise.reject(Object.assign(new Error('push service'), { statusCode: status }));
    calls.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as Record<string, unknown>,
      urgency: options?.urgency,
    });
    return Promise.resolve({ statusCode: 201 });
  });
  return {
    calls,
    sender,
    deps: { db, provider: new WebPushNotificationProvider(db, sender, now && (() => now)) },
  };
};

const alertsOf = (userId: string) =>
  db.selectFrom('notifications').selectAll().where('user_id', '=', userId).execute();

describe('notify job', () => {
  it('pushes once to an offline user with the sender as title, the text as body and ids in data', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const device = await makeDevice(bob);
    const chat = await makeChat([alice, bob]);
    const { calls, deps } = fakeSender();

    const { result } = await handleNotify(deps, jobFor(bob, chat));

    expect(result).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint: device.endpoint,
      urgency: 'high',
      payload: {
        type: 'message',
        kind: 'message',
        title: 'alice',
        body: 'hello there',
        conversation_id: chat.conversationId,
        message_id: chat.messageId,
        seq: 1,
        group: false,
      },
    });
    expect(await alertsOf(bob)).toMatchObject([{ kind: 'message', message_id: chat.messageId }]);
  });

  it('names the group in the title and describes photos and voice notes', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    await makeDevice(bob);
    const photo = await makeChat([alice, bob], { group: true, type: 'image', body: null });
    const voice = await makeChat([alice, bob], { type: 'voice', body: null });
    const caption = await makeChat([alice, bob], { type: 'image', body: 'sunset' });
    const { calls, deps } = fakeSender();

    await handleNotify(deps, jobFor(bob, photo));
    await handleNotify(deps, jobFor(bob, voice));
    await handleNotify(deps, jobFor(bob, caption));

    expect(calls.map((c) => [c.payload.title, c.payload.body])).toEqual([
      ['alice in Team', 'Sent you a photo'],
      ['alice', 'Sent you a voice message'],
      ['alice', 'Photo: sunset'],
    ]);
    expect(calls[0]!.payload.group).toBe(true);
  });

  it('sends to every device of the user, but not to one that already has the message', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const phone = await makeDevice(bob);
    const laptop = await makeDevice(bob);
    const tablet = await makeDevice(bob);
    const chat = await makeChat([alice, bob]);
    // The tablet's app received the message live and said so.
    await db
      .insertInto('device_cursors')
      .values({
        device_id: tablet.deviceId,
        conversation_id: chat.conversationId,
        delivered_seq: 1,
      })
      .execute();
    const { calls, deps } = fakeSender();

    const { summary } = await handleNotify(deps, jobFor(bob, chat));

    expect(calls.map((c) => c.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    expect(summary).toMatchObject({ subscriptions: 3, sent: 2, skipped_delivered: 1 });
  });

  it('stays silent in a muted chat, but a mention or a reply gets through', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    await makeDevice(bob);
    const chat = await makeChat([alice, bob], { mentions: [bob] });
    await db
      .updateTable('conversation_members')
      .set({ muted_until: new Date(Date.now() + 3_600_000) })
      .where('user_id', '=', bob)
      .execute();
    const { calls, deps } = fakeSender();

    expect((await handleNotify(deps, jobFor(bob, chat, 'message'))).result).toBe('skipped_muted');
    expect(calls).toHaveLength(0);
    expect(await alertsOf(bob)).toHaveLength(0);

    expect((await handleNotify(deps, jobFor(bob, chat, 'mention'))).result).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(await alertsOf(bob)).toMatchObject([{ kind: 'mention' }]);
  });

  it('keeps the centre row when the person has no push subscription', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const chat = await makeChat([alice, bob]);
    const { calls, deps } = fakeSender();

    expect((await handleNotify(deps, jobFor(bob, chat))).result).toBe('no_subscription');
    expect(calls).toHaveLength(0);
    expect(await alertsOf(bob)).toHaveLength(1);
    // A second run (a retry) does not add a second row.
    await handleNotify(deps, jobFor(bob, chat));
    expect(await alertsOf(bob)).toHaveLength(1);
  });

  it('does nothing for a message that was read, deleted or left behind', async () => {
    const [alice, bob, carol] = [
      await makeUser('alice'),
      await makeUser('bob'),
      await makeUser('carol'),
    ];
    await makeDevice(bob);
    await makeDevice(carol);
    const read = await makeChat([alice, bob]);
    await db
      .updateTable('conversation_members')
      .set({ read_seq: 1 })
      .where('conversation_id', '=', read.conversationId)
      .where('user_id', '=', bob)
      .execute();
    const deleted = await makeChat([alice, carol]);
    await db
      .updateTable('messages')
      .set({ deleted_at: new Date(), body_text: null })
      .where('id', '=', deleted.messageId)
      .execute();
    const { calls, deps } = fakeSender();

    expect((await handleNotify(deps, jobFor(bob, read))).result).toBe('skipped_seen');
    expect((await handleNotify(deps, jobFor(carol, deleted))).result).toBe('skipped_gone');
    expect(calls).toHaveLength(0);
  });

  it('disables a subscription the push service reports as gone (410) and still sends to the rest', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const gone = await makeDevice(bob);
    await makeDevice(bob);
    const chat = await makeChat([alice, bob]);
    const { calls, deps } = fakeSender({ [gone.endpoint]: 410 });

    const { summary } = await handleNotify(deps, jobFor(bob, chat));

    expect(summary).toMatchObject({ sent: 1, expired: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    const row = await db
      .selectFrom('push_subscriptions')
      .select(['disabled_at', 'last_status'])
      .where('endpoint', '=', gone.endpoint)
      .executeTakeFirstOrThrow();
    expect(row.disabled_at).not.toBeNull();
    expect(row.last_status).toBe(410);
    // Logs and the summary name only the push service host, never the endpoint.
    expect(summary.services).toContainEqual({ host: 'push.example', status: 410 });
  });

  it('throws on a push service failure so pg-boss retries, and keeps the subscription', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const flaky = await makeDevice(bob);
    const chat = await makeChat([alice, bob]);
    const { deps } = fakeSender({ [flaky.endpoint]: 503 });

    await expect(handleNotify(deps, jobFor(bob, chat))).rejects.toThrow('push service');
    const row = await db
      .selectFrom('push_subscriptions')
      .select(['disabled_at', 'last_status'])
      .where('endpoint', '=', flaky.endpoint)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ disabled_at: null, last_status: 503 });
  });

  it('honours the device choices: previews off and quiet hours', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const hidden = await makeDevice(bob);
    const quiet = await makeDevice(bob);
    await db
      .updateTable('push_subscriptions')
      .set({ prefs: JSON.stringify({ previews: false }) })
      .where('endpoint', '=', hidden.endpoint)
      .execute();
    // Quiet from 22:00 to 07:00 on a device whose clock is UTC; it is 23:30 there.
    await db
      .updateTable('push_subscriptions')
      .set({
        prefs: JSON.stringify({ quiet: { from_min: 22 * 60, to_min: 7 * 60, offset_min: 0 } }),
      })
      .where('endpoint', '=', quiet.endpoint)
      .execute();
    const chat = await makeChat([alice, bob]);
    const { calls, deps } = fakeSender({}, new Date('2026-03-01T23:30:00Z'));

    const { summary } = await handleNotify(deps, jobFor(bob, chat));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ endpoint: hidden.endpoint, payload: { body: 'New message' } });
    expect(summary.skipped_quiet).toBe(1);
  });

  it('does not push to a device that was signed out (revoked)', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const old = await makeDevice(bob);
    await db
      .updateTable('devices')
      .set({ revoked_at: new Date() })
      .where('id', '=', old.deviceId)
      .execute();
    const chat = await makeChat([alice, bob]);
    const { calls, deps } = fakeSender();

    expect((await handleNotify(deps, jobFor(bob, chat))).result).toBe('no_subscription');
    expect(calls).toHaveLength(0);
  });
});

describe('purge-notifications', () => {
  it('deletes alerts older than 30 days and keeps newer ones', async () => {
    const [alice, bob] = [await makeUser('alice'), await makeUser('bob')];
    const chat = await makeChat([alice, bob]);
    await db
      .insertInto('notifications')
      .values([
        {
          user_id: bob,
          conversation_id: chat.conversationId,
          kind: 'reminder',
          created_at: new Date(Date.now() - 31 * 86_400_000),
        },
        {
          user_id: bob,
          conversation_id: chat.conversationId,
          kind: 'missed_call',
          created_at: new Date(Date.now() - 29 * 86_400_000),
        },
      ])
      .execute();

    expect(await purgeOldNotifications(db)).toBe(1);
    expect((await alertsOf(bob)).map((n) => n.kind)).toEqual(['missed_call']);
  });
});
