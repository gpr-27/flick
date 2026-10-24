import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allocateSeqAndInsertMessage, type SendMessageInput } from '../src/queries/messages.js';
import { createTestDatabase, makeConversation, makeUser, type TestDatabase } from './helpers.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase({ poolMax: 60 });
});
afterAll(async () => {
  await t.destroy();
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

async function seqs(conversationId: string): Promise<number[]> {
  const rows = await t.db
    .selectFrom('messages')
    .select('seq')
    .where('conversation_id', '=', conversationId)
    .orderBy('seq')
    .execute();
  return rows.map((r) => r.seq);
}

async function lastSeq(conversationId: string): Promise<number> {
  const row = await t.db
    .selectFrom('conversations')
    .select('last_seq')
    .where('id', '=', conversationId)
    .executeTakeFirstOrThrow();
  return row.last_seq;
}

function send(
  conversationId: string,
  user: { id: string; deviceId: string },
  extra: Partial<SendMessageInput> = {},
) {
  return allocateSeqAndInsertMessage(t.db, {
    conversationId,
    senderId: user.id,
    senderDeviceId: user.deviceId,
    clientMessageId: randomUUID(),
    type: 'text',
    bodyText: 'hello',
    ...extra,
  });
}

describe('sequence allocation', () => {
  it('50 parallel transactions doing UPDATE ... RETURNING then INSERT get unique, contiguous seqs', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const allocated = await Promise.all(
      range(50).map(async () => {
        const client = await t.pool.connect();
        try {
          await client.query('BEGIN');
          const r = await client.query<{ last_seq: number }>(
            'UPDATE conversations SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq',
            [conv],
          );
          const seq = r.rows[0]!.last_seq;
          await client.query(
            `INSERT INTO messages (conversation_id, seq, type) VALUES ($1, $2, 'system')`,
            [conv, seq],
          );
          await client.query('COMMIT');
          return seq;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }),
    );
    expect([...allocated].sort((a, b) => a - b)).toEqual(range(50));
    expect(await seqs(conv)).toEqual(range(50));
    expect(await lastSeq(conv)).toBe(50);
  });

  it('parallel sends from several users get seqs 1..N, each with one outbox event in seq order', async () => {
    const users = await Promise.all(range(4).map(() => makeUser(t.db)));
    const conv = await makeConversation(
      t.db,
      'group',
      users.map((u) => ({ userId: u.id })),
    );
    await Promise.all(range(40).map((i) => send(conv, users[i % 4]!)));
    expect(await seqs(conv)).toEqual(range(40));
    const events = await t.db
      .selectFrom('outbox')
      .select('payload')
      .where('partition_key', '=', conv)
      .orderBy('id')
      .execute();
    // Outbox ids follow seq order within a conversation, because both are assigned under the row lock.
    expect(events.map((e) => e.payload.seq)).toEqual(range(40));
  });
});

describe('idempotent send (insert with rollback on duplicate)', () => {
  it('a retry returns the original message and does not use up a seq', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const clientMessageId = randomUUID();
    const first = await send(conv, u, { clientMessageId });
    const retry = await send(conv, u, { clientMessageId });
    expect(first.duplicate).toBe(false);
    expect(retry).toEqual({ message: first.message, duplicate: true });
    expect(await lastSeq(conv)).toBe(1);
    expect((await send(conv, u)).message.seq).toBe(2);
  });

  it('25 concurrent copies of one message create exactly one row and leave no seq gap', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const clientMessageId = randomUUID();
    const results = await Promise.all(range(25).map(() => send(conv, u, { clientMessageId })));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    expect(await seqs(conv)).toEqual([1]);
    expect(await lastSeq(conv)).toBe(1);
    expect(
      await t.db.selectFrom('outbox').select('id').where('partition_key', '=', conv).execute(),
    ).toHaveLength(1);
    expect((await send(conv, u)).message.seq).toBe(2);
  });

  it('duplicates mixed with distinct messages keep seqs contiguous', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const ids = range(10).map(() => randomUUID());
    const results = await Promise.all(
      ids.flatMap((id) => range(4).map(() => send(conv, u, { clientMessageId: id }))),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(10);
    expect(await seqs(conv)).toEqual(range(10));
  });

  it('reusing a client_message_id in another conversation is rejected', async () => {
    const u = await makeUser(t.db);
    const c1 = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const c2 = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const clientMessageId = randomUUID();
    await send(c1, u, { clientMessageId });
    await expect(send(c2, u, { clientMessageId })).rejects.toMatchObject({
      code: 'idempotency_conflict',
    });
  });
});

describe('a failed send rolls back completely', () => {
  it('non-members and non-admins in admin-only groups cannot send, and no seq is used', async () => {
    const owner = await makeUser(t.db);
    const member = await makeUser(t.db);
    const outsider = await makeUser(t.db);
    const conv = await makeConversation(
      t.db,
      'group',
      [{ userId: owner.id, role: 'owner' }, { userId: member.id }],
      { admin_only_send: true },
    );
    await expect(send(conv, outsider)).rejects.toMatchObject({ code: 'not_a_member' });
    await expect(send(conv, member)).rejects.toMatchObject({ code: 'not_allowed' });
    expect(await lastSeq(conv)).toBe(0);
    expect((await send(conv, owner)).message.seq).toBe(1);
  });

  it('an attachment the sender does not own undoes the message, the seq and the outbox event', async () => {
    const u = await makeUser(t.db);
    const other = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const upload = await t.db
      .insertInto('attachments')
      .values({
        owner_id: other.id,
        object_key: randomUUID(),
        declared_mime: 'image/png',
        size_bytes: 10,
        sha256: Buffer.alloc(32),
        status: 'uploaded',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(send(conv, u, { type: 'image', attachmentId: upload.id })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
    expect(await lastSeq(conv)).toBe(0);
    expect(await seqs(conv)).toEqual([]);
    expect(
      await t.db.selectFrom('outbox').select('id').where('partition_key', '=', conv).execute(),
    ).toEqual([]);
  });

  it('attaching your own upload marks it attached', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const upload = await t.db
      .insertInto('attachments')
      .values({
        owner_id: u.id,
        object_key: randomUUID(),
        declared_mime: 'image/png',
        size_bytes: 10,
        sha256: Buffer.alloc(32),
        status: 'uploaded',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { message } = await send(conv, u, { type: 'image', attachmentId: upload.id });
    expect(message.attachment_id).toBe(upload.id);
    const row = await t.db
      .selectFrom('attachments')
      .select('status')
      .where('id', '=', upload.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('attached');
  });
});

it('disappearing messages get expire_at from the conversation timer', async () => {
  const u = await makeUser(t.db);
  const conv = await makeConversation(t.db, 'group', [{ userId: u.id }], {
    disappearing_seconds: 86_400,
  });
  const { message } = await send(conv, u);
  expect(message.expire_at!.getTime() - message.created_at.getTime()).toBe(86_400_000);
});
