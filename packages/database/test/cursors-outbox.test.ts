import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findOrCreateDirectConversation } from '../src/queries/conversations.js';
import {
  advanceCursor,
  advanceReadSeq,
  receiptWatermarks,
  recipientCursors,
} from '../src/queries/cursors.js';
import { allocateSeqAndInsertMessage } from '../src/queries/messages.js';
import { outboxBacklog, buildOutboxClaimQuery, purgeOldOutboxRows } from '../src/queries/outbox.js';
import {
  addDevice,
  createTestDatabase,
  makeConversation,
  makeUser,
  type TestDatabase,
} from './helpers.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase({ poolMax: 40 });
});
afterAll(async () => {
  await t.destroy();
});

async function sendMany(conv: string, u: { id: string; deviceId: string }, n: number) {
  for (let i = 0; i < n; i++) {
    await allocateSeqAndInsertMessage(t.db, {
      conversationId: conv,
      senderId: u.id,
      senderDeviceId: u.deviceId,
      clientMessageId: randomUUID(),
      type: 'text',
      bodyText: 'hi',
    });
  }
}

describe('cursors', () => {
  it('a device cursor only moves forward and cannot pass last_seq', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    await sendMany(conv, u, 10);
    const at = (deliveredSeq: number) =>
      advanceCursor(t.db, { deviceId: u.deviceId, conversationId: conv, deliveredSeq });
    expect(await at(5)).toEqual({ deliveredSeq: 5, syncedSeq: 0 });
    expect(await at(3)).toEqual({ deliveredSeq: 5, syncedSeq: 0 }); // late ack: ignored
    expect(await at(999)).toEqual({ deliveredSeq: 10, syncedSeq: 0 }); // capped at last_seq
  });

  it('concurrent acks arriving in random order end at the highest one', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    await sendMany(conv, u, 30);
    const acks = Array.from({ length: 30 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    await Promise.all(
      acks.map((s) =>
        advanceCursor(t.db, { deviceId: u.deviceId, conversationId: conv, deliveredSeq: s }),
      ),
    );
    expect(await advanceCursor(t.db, { deviceId: u.deviceId, conversationId: conv })).toEqual({
      deliveredSeq: 30,
      syncedSeq: 0,
    });
  });

  it('the read cursor only moves forward; non-members are rejected', async () => {
    const u = await makeUser(t.db);
    const outsider = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    await sendMany(conv, u, 6);
    expect(await advanceReadSeq(t.db, { conversationId: conv, userId: u.id, readSeq: 4 })).toBe(4);
    expect(await advanceReadSeq(t.db, { conversationId: conv, userId: u.id, readSeq: 2 })).toBe(4);
    expect(await advanceReadSeq(t.db, { conversationId: conv, userId: u.id, readSeq: 100 })).toBe(
      6,
    );
    await expect(
      advanceReadSeq(t.db, { conversationId: conv, userId: outsider.id, readSeq: 1 }),
    ).rejects.toMatchObject({ code: 'not_a_member' });
  });

  it('ticks: delivered when every recipient has one device past the seq; read implies delivered', async () => {
    const sender = await makeUser(t.db);
    const r1 = await makeUser(t.db);
    const r2 = await makeUser(t.db);
    const r2Laptop = await addDevice(t.db, r2.id);
    const conv = await makeConversation(t.db, 'group', [
      { userId: sender.id },
      { userId: r1.id },
      { userId: r2.id },
    ]);
    await sendMany(conv, sender, 10);
    const watermarks = async () => receiptWatermarks(await recipientCursors(t.db, conv, sender.id));

    expect(await watermarks()).toEqual({ deliveredSeq: 0, readSeq: 0 });
    await advanceCursor(t.db, { deviceId: r1.deviceId, conversationId: conv, deliveredSeq: 8 });
    await advanceCursor(t.db, { deviceId: r2.deviceId, conversationId: conv, deliveredSeq: 3 });
    await advanceCursor(t.db, { deviceId: r2Laptop, conversationId: conv, deliveredSeq: 6 }); // r2's best device counts
    expect(await watermarks()).toEqual({ deliveredSeq: 6, readSeq: 0 });
    await advanceReadSeq(t.db, { conversationId: conv, userId: r1.id, readSeq: 9 });
    await advanceReadSeq(t.db, { conversationId: conv, userId: r2.id, readSeq: 7 });
    expect(await watermarks()).toEqual({ deliveredSeq: 7, readSeq: 7 });
  });
});

describe('outbox', () => {
  it('four parallel dispatchers claim every event exactly once', async () => {
    await sql`DELETE FROM outbox`.execute(t.db);
    await sql`INSERT INTO outbox (topic, partition_key, payload) SELECT 'chat.message.v1', 'c' || (g % 7), '{}' FROM generate_series(1, 500) g`.execute(
      t.db,
    );
    const claimedIds: number[] = [];
    const dispatcher = async () => {
      for (;;) {
        const claimed = await t.db.transaction().execute(async (trx) => {
          const rows = await buildOutboxClaimQuery(trx, 25).execute();
          if (rows.length === 0) return 0;
          await new Promise((r) => setTimeout(r, 2));
          claimedIds.push(...rows.map((r) => r.id));
          await trx
            .updateTable('outbox')
            .set({ published_at: sql<Date>`now()` })
            .where(
              'id',
              'in',
              rows.map((r) => r.id),
            )
            .execute();
          return rows.length;
        });
        if (claimed === 0) return;
      }
    };
    await Promise.all([dispatcher(), dispatcher(), dispatcher(), dispatcher()]);
    expect(claimedIds).toHaveLength(500);
    expect(new Set(claimedIds).size).toBe(500);
    expect((await outboxBacklog(t.db)).pending).toBe(0);
  });

  it('the retention purge removes only old published events and old dedupe rows', async () => {
    await sql`DELETE FROM outbox`.execute(t.db);
    await sql`DELETE FROM processed_events`.execute(t.db);
    await sql`
      INSERT INTO outbox (topic, partition_key, payload, published_at) VALUES
        ('chat.message.v1', 'old', '{}', now() - interval '8 days'),
        ('chat.message.v1', 'recent', '{}', now() - interval '1 day'),
        ('chat.message.v1', 'unpublished', '{}', NULL)
    `.execute(t.db);
    await sql`INSERT INTO processed_events (consumer, event_id, processed_at) VALUES ('d', gen_random_uuid(), now() - interval '30 days'), ('d', gen_random_uuid(), now())`.execute(
      t.db,
    );
    expect(await purgeOldOutboxRows(t.db)).toEqual({ outbox: 1, processedEvents: 1 });
  });
});

describe('races the database settles', () => {
  it('two users opening a chat with each other at the same time get one conversation', async () => {
    const a = await makeUser(t.db);
    const b = await makeUser(t.db);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        findOrCreateDirectConversation(t.db, i % 2 ? a.id : b.id, i % 2 ? b.id : a.id),
      ),
    );
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const members = await t.db
      .selectFrom('conversation_members')
      .select('user_id')
      .where('conversation_id', '=', results[0]!.conversationId)
      .execute();
    expect(members).toHaveLength(2);
  });
});
