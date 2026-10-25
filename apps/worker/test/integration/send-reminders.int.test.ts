import { randomUUID } from 'node:crypto';
import {
  FLICK_BOT_USER_ID,
  allocateSeqAndInsertMessage,
  createDb,
  createPool,
  findOrCreateDirectConversation,
  migrateUp,
  type Database,
} from '@chat/db';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger.js';
import {
  handleReminderPush,
  sendDueReminders,
  type ReminderPushJob,
} from '../../src/jobs/send-reminders.js';
import type { PushSender } from '../../src/web-push-provider.js';

// Needs real Postgres (DATABASE_URL). Each run gets its own database.
let db: Kysely<Database>;
const logger = createLogger('silent');

beforeAll(async () => {
  const name = `r_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
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

async function makeUser(name: string): Promise<{ id: string; flickChat: string }> {
  const row = await db
    .insertInto('users')
    .values({ username: `${name}_${randomUUID().slice(0, 6)}`, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  const { conversationId } = await findOrCreateDirectConversation(db, row.id, FLICK_BOT_USER_ID);
  return { id: row.id, flickChat: conversationId };
}

/** A direct chat between two people with one message from `sender`. */
async function chatWithMessage(me: string, sender: { id: string }, text: string) {
  const { conversationId } = await findOrCreateDirectConversation(db, me, sender.id);
  const sent = await allocateSeqAndInsertMessage(db, {
    conversationId,
    senderId: sender.id,
    senderDeviceId: null,
    clientMessageId: null,
    type: 'text',
    bodyText: text,
  });
  return { conversationId, messageId: sent.message.id };
}

async function remind(
  userId: string,
  conversationId: string,
  messageId: string | null,
  note: string | null = null,
  at: Date = new Date(Date.now() - 1_000),
): Promise<string> {
  const row = await db
    .insertInto('reminders')
    .values({
      user_id: userId,
      conversation_id: conversationId,
      message_id: messageId,
      note,
      remind_at: at,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const rowOf = (id: string) =>
  db.selectFrom('reminders').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const flickMessages = (chat: string) =>
  db
    .selectFrom('messages')
    .selectAll()
    .where('conversation_id', '=', chat)
    .where('sender_id', '=', FLICK_BOT_USER_ID)
    .orderBy('seq')
    .execute();

function pushRecorder() {
  const jobs: ReminderPushJob[] = [];
  return { jobs, enqueue: (job: ReminderPushJob) => Promise.resolve(void jobs.push(job)) };
}

describe('send-reminders', () => {
  it('delivers a due reminder once: a Flick chat message and a queued push', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Priya');
    const { conversationId, messageId } = await chatWithMessage(
      me.id,
      friend,
      'bring the passport',
    );
    const id = await remind(me.id, conversationId, messageId, 'before Friday');
    const later = await remind(me.id, conversationId, null, null, new Date(Date.now() + 3_600_000));
    const rec = pushRecorder();

    expect(await sendDueReminders(db, rec.enqueue)).toEqual({ sent: 1 });
    // A second run (another worker, a retry) delivers nothing more.
    expect(await sendDueReminders(db, rec.enqueue)).toEqual({ sent: 0 });

    const messages = await flickMessages(me.flickChat);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body_text).toContain('Reminder');
    expect(messages[0]!.body_text).toContain('bring the passport');
    expect(messages[0]!.body_text).toContain('Priya');
    expect(messages[0]!.body_text).toContain('before Friday');
    expect(messages[0]!.body_text).toContain(`[Open chat](/?c=${conversationId})`);

    expect(rec.jobs).toEqual([{ reminder_id: id, bot_message_id: messages[0]!.id }]);
    const sent = await rowOf(id);
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).not.toBeNull();
    expect((await rowOf(later)).status).toBe('pending');

    // The normal fan-out picks the message up through the outbox, so it shows as unread.
    const outbox = await db.selectFrom('outbox').select('payload').execute();
    expect(JSON.stringify(outbox)).toContain(messages[0]!.id);
  });

  it('a reminder about a whole chat names the chat', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Dev');
    const { conversationId } = await chatWithMessage(me.id, friend, 'hello');
    await remind(me.id, conversationId, null);
    await sendDueReminders(db, pushRecorder().enqueue);
    const [message] = await flickMessages(me.flickChat);
    expect(message!.body_text).toContain('Dev');
    expect(message!.body_text).not.toContain('hello');
  });

  it('skips a cancelled reminder', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Ana');
    const { conversationId, messageId } = await chatWithMessage(me.id, friend, 'x');
    const id = await remind(me.id, conversationId, messageId);
    await db.deleteFrom('reminders').where('id', '=', id).execute(); // what cancelling does
    const cancelled = await remind(me.id, conversationId, messageId);
    await db
      .updateTable('reminders')
      .set({ status: 'cancelled' })
      .where('id', '=', cancelled)
      .execute();
    const rec = pushRecorder();

    expect(await sendDueReminders(db, rec.enqueue)).toEqual({ sent: 0 });
    expect(rec.jobs).toEqual([]);
    expect(await flickMessages(me.flickChat)).toEqual([]);
  });

  it.each([
    [
      'deleted',
      (id: string) =>
        db
          .updateTable('messages')
          .set({ deleted_at: new Date(), body_text: null })
          .where('id', '=', id)
          .execute(),
    ],
    [
      'expired',
      (id: string) =>
        db
          .updateTable('messages')
          .set({ expire_at: new Date(Date.now() - 1_000) })
          .where('id', '=', id)
          .execute(),
    ],
  ])('a %s message is not quoted; the text says it was deleted', async (_name, change) => {
    const me = await makeUser('me');
    const friend = await makeUser('Ravi');
    const { conversationId, messageId } = await chatWithMessage(me.id, friend, 'secret plan');
    await remind(me.id, conversationId, messageId);
    await change(messageId);

    await sendDueReminders(db, pushRecorder().enqueue);
    const [message] = await flickMessages(me.flickChat);
    expect(message!.body_text).toContain('A message you wanted to be reminded about was deleted');
    expect(message!.body_text).not.toContain('secret plan');
  });

  it('a message hidden "for me" is not quoted', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Sam');
    const { conversationId, messageId } = await chatWithMessage(me.id, friend, 'private words');
    await remind(me.id, conversationId, messageId);
    await db
      .insertInto('hidden_messages')
      .values({ user_id: me.id, message_id: messageId })
      .execute();

    await sendDueReminders(db, pushRecorder().enqueue);
    const [message] = await flickMessages(me.flickChat);
    expect(message!.body_text).toContain('was deleted');
    expect(message!.body_text).not.toContain('private words');
  });

  it('markdown in a quote cannot format the reminder', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Kim');
    const { conversationId, messageId } = await chatWithMessage(
      me.id,
      friend,
      '[click](https://evil.example) **now**',
    );
    await remind(me.id, conversationId, messageId);
    await sendDueReminders(db, pushRecorder().enqueue);
    const [message] = await flickMessages(me.flickChat);
    expect(message!.body_text).not.toContain('[click](https');
    expect(message!.body_text).toContain('\\[click\\]\\(https');
  });

  it('two workers at the same moment deliver each reminder once', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Lee');
    const { conversationId, messageId } = await chatWithMessage(me.id, friend, 'once only');
    const ids = await Promise.all([1, 2, 3].map(() => remind(me.id, conversationId, messageId)));
    const rec = pushRecorder();

    const runs = await Promise.all([
      sendDueReminders(db, rec.enqueue),
      sendDueReminders(db, rec.enqueue),
      sendDueReminders(db, rec.enqueue),
    ]);

    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(3);
    expect(await flickMessages(me.flickChat)).toHaveLength(3);
    expect(rec.jobs.map((j) => j.reminder_id).sort()).toEqual([...ids].sort());
  });

  it('still marks the reminder sent and queues the push when there is no Flick chat', async () => {
    const lonely = await db
      .insertInto('users')
      .values({ username: `lonely_${randomUUID().slice(0, 6)}`, display_name: 'Lonely' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { conversationId } = await findOrCreateDirectConversation(
      db,
      lonely.id,
      (await makeUser('pal')).id,
    );
    const id = await remind(lonely.id, conversationId, null);
    const rec = pushRecorder();

    expect(await sendDueReminders(db, rec.enqueue, logger)).toEqual({ sent: 1 });
    expect(rec.jobs).toEqual([{ reminder_id: id, bot_message_id: null }]);
    expect((await rowOf(id)).status).toBe('sent');
  });

  it('a failing push queue does not undo the delivery', async () => {
    const me = await makeUser('me');
    const friend = await makeUser('Zed');
    const { conversationId } = await chatWithMessage(me.id, friend, 'hi');
    const id = await remind(me.id, conversationId, null);

    const result = await sendDueReminders(
      db,
      () => Promise.reject(new Error('queue down')),
      logger,
    );

    expect(result).toEqual({ sent: 1 });
    expect((await rowOf(id)).status).toBe('sent');
    expect(await flickMessages(me.flickChat)).toHaveLength(1);
  });
});

describe('reminder push', () => {
  async function delivered(text: string, note: string | null = null) {
    const me = await makeUser('me');
    const friend = await makeUser('Nia');
    const { conversationId, messageId } = await chatWithMessage(me.id, friend, text);
    const id = await remind(me.id, conversationId, messageId, note);
    await sendDueReminders(db, pushRecorder().enqueue);
    return { me, id, conversationId, messageId };
  }

  it('sends a Reminder notification that opens the chat, to every subscription', async () => {
    const { me, id, conversationId } = await delivered('see the doctor', 'at 5');
    await db
      .insertInto('push_subscriptions')
      .values({
        user_id: me.id,
        endpoint: `https://push.example/${randomUUID()}`,
        p256dh: 'p',
        auth: 'a',
      })
      .execute();
    const sent: string[] = [];
    const sender: PushSender = (_target, payload) => Promise.resolve(void sent.push(payload));

    const result = await handleReminderPush(
      { db, sender, logger },
      { reminder_id: id, bot_message_id: 'bot-message-1' },
    );

    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      title: 'Reminder',
      body: '"see the doctor" - Nia | at 5',
      conversation_id: conversationId,
      message_id: 'bot-message-1',
    });
  });

  it('is a logged no-op without VAPID keys, and ignores a reminder that is not sent', async () => {
    const { id } = await delivered('hello');
    expect(
      await handleReminderPush(
        { db, sender: null, logger },
        { reminder_id: id, bot_message_id: null },
      ),
    ).toBe('simulated');
    const sender: PushSender = () => Promise.reject(new Error('must not be called'));
    expect(
      await handleReminderPush(
        { db, sender, logger },
        { reminder_id: randomUUID(), bot_message_id: null },
      ),
    ).toBe('skipped');
  });

  it('does not put a deleted message into the push', async () => {
    const { me, id, messageId } = await delivered('top secret');
    await db
      .insertInto('push_subscriptions')
      .values({
        user_id: me.id,
        endpoint: `https://push.example/${randomUUID()}`,
        p256dh: 'p',
        auth: 'a',
      })
      .execute();
    await db
      .updateTable('messages')
      .set({ deleted_at: new Date(), body_text: null })
      .where('id', '=', messageId)
      .execute();
    const sent: string[] = [];
    const sender: PushSender = (_target, payload) => Promise.resolve(void sent.push(payload));

    await handleReminderPush({ db, sender, logger }, { reminder_id: id, bot_message_id: null });

    expect(sent[0]).toContain('was deleted');
    expect(sent[0]).not.toContain('top secret');
  });
});
