import { randomUUID } from 'node:crypto';
import { createDb, createPool, migrateUp, type Database } from '@chat/db';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendDueScheduled } from '../../src/jobs/send-scheduled.js';

// Needs real Postgres (DATABASE_URL). Each run gets its own database.
let db: Kysely<Database>;

beforeAll(async () => {
  const name = `s_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
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

async function makeUser(name: string): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ username: `${name}_${randomUUID().slice(0, 6)}`, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeGroup(members: string[]): Promise<string> {
  const conv = await db
    .insertInto('conversations')
    .values({ type: 'group', name: 'Team' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(members.map((user_id) => ({ conversation_id: conv.id, user_id })))
    .execute();
  return conv.id;
}

async function schedule(userId: string, conversationId: string, sendAt: Date): Promise<string> {
  const row = await db
    .insertInto('scheduled_messages')
    .values({
      user_id: userId,
      conversation_id: conversationId,
      body_text: 'on time',
      send_at: sendAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const past = () => new Date(Date.now() - 1_000);
const future = () => new Date(Date.now() + 3_600_000);

const statusOf = async (id: string) =>
  db.selectFrom('scheduled_messages').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

describe('send-scheduled', () => {
  it('sends a due message once, as the sender, and leaves a future one alone', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const conv = await makeGroup([alice, bob]);
    const due = await schedule(alice, conv, past());
    const later = await schedule(alice, conv, future());

    expect(await sendDueScheduled(db)).toEqual({ sent: 1, failed: 0 });
    // Running again (a second worker, a retry) must not send it a second time.
    expect(await sendDueScheduled(db)).toEqual({ sent: 0, failed: 0 });

    const messages = await db
      .selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conv)
      .execute();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sender_id: alice,
      type: 'text',
      body_text: 'on time',
      seq: 1,
    });
    expect((await statusOf(due)).status).toBe('sent');
    expect((await statusOf(later)).status).toBe('pending');

    // The normal fan-out picks it up through the outbox, like any message.
    const outbox = await db.selectFrom('outbox').select('payload').execute();
    expect(JSON.stringify(outbox)).toContain(messages[0]!.id);
  });

  it('does not send for someone who left the group; the row says why', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const conv = await makeGroup([alice, bob]);
    const id = await schedule(alice, conv, past());
    await db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', conv)
      .where('user_id', '=', alice)
      .execute();

    expect(await sendDueScheduled(db)).toEqual({ sent: 0, failed: 1 });

    const row = await statusOf(id);
    expect(row.status).toBe('failed');
    expect(row.failed_reason).toMatch(/no longer in this chat/);
    const messages = await db
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', conv)
      .execute();
    expect(messages).toHaveLength(0);
    // The seq counter was rolled back with the failed send: no gap in the chat.
    const after = await db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(after.last_seq).toBe(0);
  });

  it('does not send into a direct chat where the other person blocked the sender', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    const conv = await db
      .insertInto('conversations')
      .values({ type: 'direct' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('conversation_members')
      .values([alice, bob].map((user_id) => ({ conversation_id: conv.id, user_id })))
      .execute();
    const id = await schedule(alice, conv.id, past());
    await db.insertInto('blocks').values({ blocker_id: bob, blocked_id: alice }).execute();

    expect(await sendDueScheduled(db)).toEqual({ sent: 0, failed: 1 });
    expect((await statusOf(id)).failed_reason).toMatch(/blocked/);
  });

  it('a cancelled message is never sent', async () => {
    const alice = await makeUser('alice');
    const conv = await makeGroup([alice]);
    const id = await schedule(alice, conv, past());
    await db.deleteFrom('scheduled_messages').where('id', '=', id).execute();

    expect(await sendDueScheduled(db)).toEqual({ sent: 0, failed: 0 });
  });
});
