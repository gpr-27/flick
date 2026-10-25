/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { SERVER_PAYLOADS } from '@chat/contracts';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { expireMessages } from '../../../worker/src/jobs/expire-messages.js';
import {
  attachment,
  cmid,
  createDatabase,
  direct,
  group,
  send,
  startStack,
  waitForOutboxDrained,
  waitUntil,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// THE DELIVERY CONTRACT (docs/architecture/delivery-guarantees.md), one claim per test.
//
//   - seqs are dense and unique, however many devices send at once
//   - a retry of the same client_message_id never makes a second message, on one replica or two
//   - receipt cursors only move forward
//   - edits, deletes and reactions take seqs, and sync returns them in order
//   - disappearing messages expire (the worker job runs against the real database)
//   - a view-once message opens once
//   - a removed member receives nothing live and nothing by sync

// The machine running these may be busy; the claims matter, not the speed.
vi.setConfig({ testTimeout: 120_000 });

let database: TestDatabase;
let stack: Stack;

beforeAll(async () => {
  database = await createDatabase('deliv');
  stack = await startStack({ databaseUrl: database.url, poolMax: 30 });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

async function seqsOf(conversationId: string): Promise<number[]> {
  const rows = await stack.db
    .selectFrom('messages')
    .select('seq')
    .where('conversation_id', '=', conversationId)
    .orderBy('seq')
    .execute();
  return rows.map((r) => Number(r.seq));
}

/** The seqs used by messages and by edits/deletes/reactions together: the conversation's whole log. */
async function logSeqs(conversationId: string): Promise<number[]> {
  const { rows } = await sql<{ seq: string }>`
    SELECT seq FROM messages WHERE conversation_id = ${conversationId}
    UNION ALL
    SELECT seq FROM message_events WHERE conversation_id = ${conversationId}
    ORDER BY seq`.execute(stack.db);
  return rows.map((r) => Number(r.seq));
}

const dense = (seqs: number[]) => seqs.map((_, i) => i + 1);

// ------------------------------------------------------------------ ordering

describe('sequence numbers', () => {
  it('stay dense and unique when 15 devices of 5 users send 20 messages each at the same moment', async () => {
    const users = await Promise.all(
      Array.from({ length: 5 }, (_, i) => stack.user(`u${String(i)}`)),
    );
    const devices: TestUser[] = [];
    for (const u of users) {
      devices.push(u, await stack.device(u), await stack.device(u));
    }
    const conv = await group(stack, users[0]!, users.slice(1));
    const systemMessages = (await seqsOf(conv)).length; // the "group created" line

    const perDevice = await Promise.all(
      devices.map(async (device) => {
        const sent: { text: string; seq: number }[] = [];
        for (let i = 0; i < 20; i++) {
          const text = `${device.deviceId.slice(0, 6)}-${String(i)}`;
          const res = await send(stack, device, conv, { type: 'text', text });
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          sent.push({ text, seq: res.body.seq });
        }
        return sent;
      }),
    );

    const total = devices.length * 20 + systemMessages;
    expect(await seqsOf(conv)).toEqual(dense(Array.from({ length: total })));
    const all = perDevice.flat().map((s) => s.seq);
    expect(new Set(all).size).toBe(all.length); // no two acks share a seq
    for (const sent of perDevice) {
      // one device sends one at a time, so its own messages are in the order it sent them
      expect(sent.map((s) => s.seq)).toEqual([...sent.map((s) => s.seq)].sort((a, b) => a - b));
    }
    const conversation = await stack.db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(Number(conversation.last_seq)).toBe(total);
  });

  it('stay dense when messages, edits, deletes and reactions all happen concurrently', async () => {
    const [a, b, c] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('c')]);
    const conv = await group(stack, a, [b, c]);
    const first = await send(stack, a, conv, { type: 'text', text: 'first' });
    const id = first.body.message_id;
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        send(stack, b, conv, { type: 'text', text: `m${String(i)}` }),
      ),
      stack.call(b, 'PUT', `/conversations/${conv}/messages/${id}/reaction`, { emoji: '👍' }),
      stack.call(c, 'PUT', `/conversations/${conv}/messages/${id}/reaction`, { emoji: '🎉' }),
      stack.call(a, 'PATCH', `/conversations/${conv}/messages/${id}`, {
        content: { type: 'text', text: 'edited' },
      }),
      ...Array.from({ length: 10 }, (_, i) =>
        send(stack, c, conv, { type: 'text', text: `n${String(i)}` }),
      ),
    ]);
    const seqs = await logSeqs(conv);
    expect(seqs).toEqual(dense(seqs));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('over Socket.IO: 6 sockets sending at once get distinct consecutive seqs in their acks', async () => {
    const users = await Promise.all(
      Array.from({ length: 6 }, (_, i) => stack.user(`s${String(i)}`)),
    );
    const conv = await group(stack, users[0]!, users.slice(1));
    const start = (await seqsOf(conv)).length;
    const clients = await Promise.all(users.map((u) => stack.connect(u)));
    const acks = await Promise.all(
      clients.flatMap((c, i) =>
        Array.from({ length: 10 }, (_, k) =>
          c.emit('send_message', {
            conversation_id: conv,
            client_message_id: cmid(),
            content: { type: 'text', text: `s${String(i)}-${String(k)}` },
          }),
        ),
      ),
    );
    for (const ack of acks) expect(ack.ok, JSON.stringify(ack)).toBe(true);
    const seqs = acks.map((a) => a.data.seq as number).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 60 }, (_, i) => start + i + 1));
  });

  it('every live client ends up with every message exactly once per delivery and in a gap-free set', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const live = await stack.connect(b);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        send(stack, a, conv, { type: 'text', text: `t${String(i)}` }),
      ),
    );
    await waitUntil(
      () => new Set(live.messages().map((m) => m.seq)).size >= 30,
      10_000,
      '30 live messages',
    );
    const seqs = live.messages().map((m) => m.seq as number);
    // delivery is at least once; the client drops repeats by seq, which leaves exactly 30 gap-free seqs
    const unique = [...new Set(seqs)].sort((x, y) => x - y);
    expect(unique).toEqual(dense(unique));
    expect(unique.length).toBe((await seqsOf(conv)).length);
  });
});

// ------------------------------------------------------------------ idempotency

describe('a retried send (same client_message_id)', () => {
  it('returns the original message and seq and creates nothing new', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const body = { client_message_id: cmid(), content: { type: 'text', text: 'once' } };
    const first = await stack.call(a, 'POST', `/conversations/${conv}/messages`, body);
    const again = await stack.call(a, 'POST', `/conversations/${conv}/messages`, body);
    expect(first.body.duplicate).toBe(false);
    expect(again.body).toEqual({ ...first.body, duplicate: true });
    expect(await seqsOf(conv)).toEqual([1]);
    // no gap: the next message gets the very next seq
    expect((await send(stack, a, conv, { type: 'text', text: 'next' })).body.seq).toBe(2);
  });

  it('is harmless when 12 copies arrive at the same moment: one message, one seq, one duplicate:false', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const body = { client_message_id: cmid(), content: { type: 'text', text: 'racing' } };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        stack.call(a, 'POST', `/conversations/${conv}/messages`, body),
      ),
    );
    for (const r of results) expect(r.status).toBe(200);
    expect(new Set(results.map((r) => r.body.message_id)).size).toBe(1);
    expect(new Set(results.map((r) => r.body.seq)).size).toBe(1);
    expect(results.filter((r) => !r.body.duplicate)).toHaveLength(1);
    expect(await seqsOf(conv)).toEqual([1]);
    const outbox = await stack.db
      .selectFrom('outbox')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('partition_key', '=', conv)
      .where('topic', '=', 'chat.message.v1')
      .executeTakeFirstOrThrow();
    expect(Number(outbox.n)).toBe(1); // a retry must not queue a second event either
  });

  it('is harmless over Socket.IO and REST mixed', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const client = await stack.connect(a);
    const id = cmid();
    const content = { type: 'text', text: 'mixed' };
    const viaSocket = await client.emit('send_message', {
      conversation_id: conv,
      client_message_id: id,
      content,
    });
    const viaRest = await stack.call(a, 'POST', `/conversations/${conv}/messages`, {
      client_message_id: id,
      content,
    });
    expect(viaSocket.data.message_id).toBe(viaRest.body.message_id);
    expect(viaRest.body.duplicate).toBe(true);
  });

  it('is harmless across two API replicas sharing one database', async () => {
    const second = await startStack({ databaseUrl: database.url });
    try {
      const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
      const conv = await direct(stack, a, b);
      const body = { client_message_id: cmid(), content: { type: 'text', text: 'two replicas' } };
      const calls = Array.from({ length: 10 }, (_, i) =>
        (i % 2 === 0 ? stack : second).call(a, 'POST', `/conversations/${conv}/messages`, body),
      );
      const results = await Promise.all(calls);
      expect(new Set(results.map((r) => r.body.message_id)).size).toBe(1);
      expect(results.filter((r) => !r.body.duplicate)).toHaveLength(1);
      expect(await seqsOf(conv)).toEqual([1]);
      // and different devices of the same user each have their own idempotency key space
      const other = await stack.device(a);
      const sameId = await stack.call(other, 'POST', `/conversations/${conv}/messages`, body);
      expect(sameId.body.duplicate).toBe(false);
      expect(await seqsOf(conv)).toEqual([1, 2]);
    } finally {
      await second.stop();
    }
  });

  it('is refused (409) when the same key is reused for a different conversation', async () => {
    const [a, b, c] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('c')]);
    const one = await direct(stack, a, b);
    const two = await direct(stack, a, c);
    const id = cmid();
    expect(
      (
        await stack.call(a, 'POST', `/conversations/${one}/messages`, {
          client_message_id: id,
          content: { type: 'text', text: 'x' },
        })
      ).status,
    ).toBe(200);
    const clash = await stack.call(a, 'POST', `/conversations/${two}/messages`, {
      client_message_id: id,
      content: { type: 'text', text: 'x' },
    });
    expect(clash.status).toBe(409);
    expect(await seqsOf(two)).toEqual([]);
  });

  it('a rejected send (not a member) leaves no seq gap behind', async () => {
    const [a, b, x] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('x')]);
    const conv = await direct(stack, a, b);
    await send(stack, a, conv, { type: 'text', text: 'one' });
    expect((await send(stack, x, conv, { type: 'text', text: 'intruder' })).status).toBe(403);
    expect((await send(stack, a, conv, { type: 'text', text: 'two' })).body.seq).toBe(2);
  });
});

// ------------------------------------------------------------------ receipts

describe('delivered and read cursors', () => {
  it('never move backward, however acks arrive, and never pass the last seq', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    for (let i = 0; i < 8; i++) await send(stack, a, conv, { type: 'text', text: `m${String(i)}` });

    const delivered = async () => {
      const row = await stack.db
        .selectFrom('device_cursors')
        .select('delivered_seq')
        .where('device_id', '=', b.deviceId)
        .where('conversation_id', '=', conv)
        .executeTakeFirst();
      return Number(row?.delivered_seq ?? 0);
    };
    const read = async () => {
      const row = await stack.db
        .selectFrom('conversation_members')
        .select('read_seq')
        .where('user_id', '=', b.id)
        .where('conversation_id', '=', conv)
        .executeTakeFirstOrThrow();
      return Number(row.read_seq);
    };

    let high = 0;
    for (const seq of [5, 3, 7, 2, 7, 1, 0]) {
      const res = await stack.call(b, 'POST', '/receipts/delivered', {
        acks: [{ conversation_id: conv, seq }],
      });
      expect(res.status).toBe(204);
      const now = await delivered();
      expect(now, `after ack ${String(seq)}`).toBeGreaterThanOrEqual(high);
      high = now;
    }
    expect(high).toBe(7);
    await stack.call(b, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: 99_999 }],
    });
    expect(await delivered()).toBe(8); // capped at last_seq

    let readHigh = 0;
    for (const seq of [4, 2, 6, 1, 6, 0]) {
      expect((await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq })).status).toBe(
        204,
      );
      const now = await read();
      expect(now, `after read ${String(seq)}`).toBeGreaterThanOrEqual(readHigh);
      readHigh = now;
    }
    expect(readHigh).toBe(6);
    await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq: 99_999 });
    expect(await read()).toBe(8);
  });

  it('survive 60 concurrent out-of-order acks: the result is the maximum', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    for (let i = 0; i < 20; i++)
      await send(stack, a, conv, { type: 'text', text: `m${String(i)}` });
    const seqs = Array.from({ length: 60 }, () => 1 + Math.floor(Math.random() * 20));
    seqs.push(20);
    await Promise.all(
      seqs.map((seq) =>
        stack.call(b, 'POST', '/receipts/delivered', { acks: [{ conversation_id: conv, seq }] }),
      ),
    );
    await Promise.all(
      seqs.map((seq) => stack.call(b, 'POST', `/conversations/${conv}/read`, { seq })),
    );
    const cursor = await stack.db
      .selectFrom('device_cursors')
      .select('delivered_seq')
      .where('device_id', '=', b.deviceId)
      .executeTakeFirstOrThrow();
    expect(Number(cursor.delivered_seq)).toBe(20);
    const member = await stack.db
      .selectFrom('conversation_members')
      .select('read_seq')
      .where('user_id', '=', b.id)
      .where('conversation_id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(Number(member.read_seq)).toBe(20);
  });

  it('only write a receipt event when the cursor really moved', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    for (let i = 0; i < 3; i++) await send(stack, a, conv, { type: 'text', text: `m${String(i)}` });
    const receipts = async () => {
      const row = await sql<{
        n: string;
      }>`SELECT count(*) AS n FROM outbox WHERE partition_key = ${conv} AND topic = 'chat.receipt.v1'`.execute(
        stack.db,
      );
      return Number(row.rows[0]!.n);
    };
    const before = await receipts();
    for (const seq of [2, 2, 1, 2])
      await stack.call(b, 'POST', '/receipts/delivered', {
        acks: [{ conversation_id: conv, seq }],
      });
    expect((await receipts()) - before).toBe(1);
    for (const seq of [3, 3, 1])
      await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq });
    expect((await receipts()) - before).toBe(2);
  });

  it('are per device for delivery, per user for reading, and the sender hears about both live', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const bPhone = await stack.device(b);
    const conv = await direct(stack, a, b);
    const sender = await stack.connect(a);
    for (let i = 0; i < 4; i++) await send(stack, a, conv, { type: 'text', text: `m${String(i)}` });
    await stack.call(b, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: 4 }],
    });
    await stack.call(bPhone, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: 2 }],
    });
    const cursors = await stack.db
      .selectFrom('device_cursors')
      .select(['device_id', 'delivered_seq'])
      .where('conversation_id', '=', conv)
      .execute();
    expect(Object.fromEntries(cursors.map((c) => [c.device_id, Number(c.delivered_seq)]))).toEqual({
      [b.deviceId]: 4,
      [bPhone.deviceId]: 2,
    });
    await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq: 3 });
    await sender.waitFor((events) =>
      events.some((e) => e.name === 'receipt_update' && e.payload.read_seq === 3),
    );
    const updates = sender.of('receipt_update');
    expect(updates.some((u) => u.delivered_seq === 4 && u.user_id === b.id)).toBe(true);
    expect(updates.some((u) => u.read_seq === 3 && u.user_id === b.id)).toBe(true);
  });
});

describe('receipts after a reload', () => {
  const summaryOf = async (user: Parameters<typeof stack.call>[0], conv: string) =>
    (await stack.call(user, 'GET', `/conversations/${conv}`)).body as {
      peer_receipts: { user_id: string; delivered_seq: number; read_seq: number }[];
    };

  it('the chat summary carries the peers cursors, so read ticks survive a reload', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    for (let i = 0; i < 4; i++) await send(stack, a, conv, { type: 'text', text: `m${String(i)}` });
    await stack.call(b, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: 4 }],
    });
    await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq: 3 });

    expect((await summaryOf(a, conv)).peer_receipts).toEqual([
      { user_id: b.id, delivered_seq: 4, read_seq: 3 },
    ]);
    // the list endpoint carries the same
    const list = (await stack.call(a, 'GET', '/conversations')).body as {
      items: { id: string; peer_receipts: unknown[] }[];
    };
    expect(list.items.find((c) => c.id === conv)?.peer_receipts).toHaveLength(1);
    // the reader's own view lists the sender, who has read nothing
    expect((await summaryOf(b, conv)).peer_receipts).toEqual([
      { user_id: a.id, delivered_seq: 0, read_seq: 0 },
    ]);
  });

  it('a group lists every other member', async () => {
    const [a, b, c] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('c')]);
    const conv = await group(stack, a, [b, c]);
    const m = (await send(stack, a, conv, { type: 'text', text: 'hi' })).body;
    await stack.call(c, 'POST', `/conversations/${conv}/read`, { seq: m.seq });
    const got = (await summaryOf(a, conv)).peer_receipts;
    expect(got.map((r) => r.user_id).sort()).toEqual([b.id, c.id].sort());
    expect(got.find((r) => r.user_id === c.id)?.read_seq).toBe(m.seq);
    expect(got.find((r) => r.user_id === b.id)?.read_seq).toBe(0);
  });

  it('hides a read position when either side turned read receipts off', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const m = (await send(stack, a, conv, { type: 'text', text: 'hi' })).body;
    await stack.call(b, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: conv, seq: m.seq }],
    });
    await stack.call(b, 'POST', `/conversations/${conv}/read`, { seq: m.seq });
    expect((await summaryOf(a, conv)).peer_receipts[0]?.read_seq).toBe(m.seq);

    // the reader turns receipts off: the sender sees delivery but no read
    await stack.call(b, 'PATCH', '/users/me/privacy', { read_receipts: false });
    expect((await summaryOf(a, conv)).peer_receipts).toEqual([
      { user_id: b.id, delivered_seq: m.seq, read_seq: 0 },
    ]);
    // the reader's own view of the sender is hidden too (receipts work both ways)
    await stack.call(a, 'POST', `/conversations/${conv}/read`, { seq: m.seq });
    expect((await summaryOf(b, conv)).peer_receipts[0]?.read_seq).toBe(0);

    // back on for the reader, off for the sender: still nothing
    await stack.call(b, 'PATCH', '/users/me/privacy', { read_receipts: true });
    await stack.call(a, 'PATCH', '/users/me/privacy', { read_receipts: false });
    expect((await summaryOf(a, conv)).peer_receipts[0]?.read_seq).toBe(0);
    expect((await summaryOf(b, conv)).peer_receipts[0]?.read_seq).toBe(0);
  });
});

// ------------------------------------------------------------------ changes take seqs

describe('edits, deletes and reactions', () => {
  it('each take the next seq, the live events carry those seqs, and sync returns them in order', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const live = await stack.connect(b);
    const m1 = (await send(stack, a, conv, { type: 'text', text: 'one' })).body; // seq 1
    const react = await stack.call(
      b,
      'PUT',
      `/conversations/${conv}/messages/${m1.message_id}/reaction`,
      { emoji: '👍' },
    ); // 2
    const edit = await stack.call(a, 'PATCH', `/conversations/${conv}/messages/${m1.message_id}`, {
      content: { type: 'text', text: 'one, edited' },
    }); // 3
    const m2 = (await send(stack, a, conv, { type: 'text', text: 'two' })).body; // 4
    const swap = await stack.call(
      b,
      'PUT',
      `/conversations/${conv}/messages/${m1.message_id}/reaction`,
      { emoji: '❤️' },
    ); // 5 (replaces the 👍)
    const unreact = await stack.call(
      b,
      'DELETE',
      `/conversations/${conv}/messages/${m1.message_id}/reaction`,
    ); // 6
    const del = await stack.call(
      a,
      'DELETE',
      `/conversations/${conv}/messages/${m2.message_id}?for=everyone`,
    ); // 7
    for (const r of [react, edit, swap, unreact, del]) expect(r.status).toBe(204);
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(4);
    expect(await logSeqs(conv)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const sync = await stack.call(b, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 100,
    });
    const seqOf = (e: any) => (e.type === 'new_message' ? e.payload.message.seq : e.payload.seq);
    expect(sync.body.events.map(seqOf)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sync.body.events.map((e: any) => e.type)).toEqual([
      'new_message',
      'reaction_added',
      'message_edited',
      'new_message',
      'reaction_added',
      'reaction_removed',
      'message_deleted',
    ]);

    // a device that already holds seq 4 gets exactly the three later changes
    const tail = await stack.call(b, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 4 }],
      limit: 100,
    });
    expect(tail.body.events.map(seqOf)).toEqual([5, 6, 7]);

    // the same thing in pages of 2 reassembles to the identical sequence
    const paged: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await stack.call(b, 'POST', '/sync', {
        cursors: [{ conversation_id: conv, after_seq: 0 }],
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      paged.push(...page.body.events.map(seqOf));
      cursor = page.body.next_cursor ?? undefined;
    } while (cursor);
    expect(paged).toEqual([1, 2, 3, 4, 5, 6, 7]);

    await waitForOutboxDrained(stack.db);
    const events = live.events.filter((e) =>
      [
        'new_message',
        'message_edited',
        'message_deleted',
        'reaction_added',
        'reaction_removed',
      ].includes(e.name),
    );
    const liveSeqs = [
      ...new Set(
        events.map((e) => (e.name === 'new_message' ? e.payload.message.seq : e.payload.seq)),
      ),
    ].sort((x: number, y: number) => x - y);
    expect(liveSeqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const { name, payload } of live.events) {
      const schema = (SERVER_PAYLOADS as Record<string, { safeParse(v: unknown): any }>)[name];
      if (schema) expect(schema.safeParse(payload).success, name).toBe(true);
    }
  });

  it('an edit is replayed as a delete when the message was deleted afterwards (no stale text, no gap)', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const m = (await send(stack, a, conv, { type: 'text', text: 'secret' })).body;
    await stack.call(a, 'PATCH', `/conversations/${conv}/messages/${m.message_id}`, {
      content: { type: 'text', text: 'edited secret' },
    });
    await stack.call(a, 'DELETE', `/conversations/${conv}/messages/${m.message_id}?for=everyone`);
    const sync = await stack.call(b, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 50,
    });
    expect(sync.body.events.map((e: any) => e.type)).toEqual([
      'new_message',
      'message_deleted',
      'message_deleted',
    ]);
    expect(JSON.stringify(sync.body)).not.toContain('secret');
  });

  it('repeating the same change takes no new seq (same reaction twice, delete twice, unreact with nothing to remove)', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const m = (await send(stack, a, conv, { type: 'text', text: 'x' })).body;
    const path = `/conversations/${conv}/messages/${m.message_id}`;
    await stack.call(b, 'DELETE', `${path}/reaction`); // nothing to remove
    await stack.call(b, 'PUT', `${path}/reaction`, { emoji: '👍' });
    await stack.call(b, 'PUT', `${path}/reaction`, { emoji: '👍' }); // same again
    expect(await logSeqs(conv)).toEqual([1, 2]);
    await stack.call(a, 'DELETE', `${path}?for=everyone`);
    await stack.call(a, 'DELETE', `${path}?for=everyone`); // a retry
    expect(await logSeqs(conv)).toEqual([1, 2, 3]);
  });

  it('delete for me, star, pin and poll votes take no seq (they are not part of the ordered log)', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const m = (await send(stack, a, conv, { type: 'text', text: 'x' })).body;
    const poll = (
      await send(stack, a, conv, {
        type: 'poll',
        question: 'q',
        options: ['a', 'b'],
        allow_multiple: false,
      })
    ).body;
    const path = `/conversations/${conv}/messages/${m.message_id}`;
    await stack.call(b, 'PUT', `${path}/star`);
    await stack.call(b, 'POST', `/conversations/${conv}/pins`, { message_id: m.message_id });
    await stack.call(b, 'POST', `/conversations/${conv}/polls/${poll.message_id}/vote`, {
      option_indexes: [1],
    });
    await stack.call(b, 'DELETE', `${path}?for=me`);
    expect(await logSeqs(conv)).toEqual([1, 2]);
  });

  it('a pin and an unpin reach the other members live, once, and not a repeated pin', async () => {
    const [a, b, c] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('c')]);
    const conv = await group(stack, a, [b, c]);
    const m = (await send(stack, a, conv, { type: 'text', text: 'pin me' })).body;
    const bLive = await stack.connect(b);
    const cLive = await stack.connect(c);
    const pins = `/conversations/${conv}/pins`;

    expect((await stack.call(a, 'POST', pins, { message_id: m.message_id })).status).toBe(204);
    await stack.call(a, 'POST', pins, { message_id: m.message_id }); // already pinned: no event
    await waitUntil(() => bLive.of('pins_changed').length >= 1, 8_000, 'b hears the pin');
    await waitUntil(() => cLive.of('pins_changed').length >= 1, 8_000, 'c hears the pin');
    expect(bLive.of('pins_changed')).toEqual([
      { conversation_id: conv, message_id: m.message_id, pinned: true, actor_user_id: a.id },
    ]);

    await stack.call(b, 'DELETE', `${pins}/${m.message_id}`);
    await waitUntil(() => cLive.of('pins_changed').length >= 2, 8_000, 'c hears the unpin');
    expect(cLive.of('pins_changed')[1]).toMatchObject({ pinned: false, actor_user_id: b.id });
    expect(bLive.of('pins_changed')).toHaveLength(2);
    expect(await logSeqs(conv)).toEqual([1, 2]); // group-created line + the message; pins take no seq
  });

  it('a concurrent double delete takes exactly one seq', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const m = (await send(stack, a, conv, { type: 'text', text: 'x' })).body;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        stack.call(a, 'DELETE', `/conversations/${conv}/messages/${m.message_id}?for=everyone`),
      ),
    );
    expect(await logSeqs(conv)).toEqual([1, 2]);
  });
});

// ------------------------------------------------------------------ disappearing messages

describe('disappearing messages', () => {
  it('stop being returned the moment they expire, and the worker job turns them into tombstones that keep their seq', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    expect(
      (
        await stack.call(a, 'PATCH', `/conversations/${conv}`, {
          settings: { disappearing_timer_s: 86_400 },
        })
      ).status,
    ).toBe(200);
    const file = await attachment(stack.db, a);
    const text = (await send(stack, a, conv, { type: 'text', text: 'this will vanish zzgone' }))
      .body;
    const photo = (
      await send(stack, a, conv, {
        type: 'image',
        attachment_id: file,
        width: 1,
        height: 1,
        caption: 'photo zzgone',
      })
    ).body;
    const keep = (await send(stack, a, conv, { type: 'text', text: 'this stays' })).body;
    // the timer is a day; move the first two into the past instead of waiting
    await sql`UPDATE messages SET expire_at = now() - interval '1 minute' WHERE id IN (${text.message_id}, ${photo.message_id})`.execute(
      stack.db,
    );

    // before the worker runs: the read paths already hide them
    const before = await stack.call(b, 'GET', `/conversations/${conv}/messages?limit=100`);
    const visible = before.body.items
      .filter((m: any) => m.content?.type !== 'system')
      .map((m: any) => m.message_id);
    expect(visible).toEqual([keep.message_id]);
    const found = await stack.call(b, 'GET', '/search?q=zzgone');
    expect(found.body.items).toEqual([]);

    const ran = await expireMessages(stack.db);
    expect(ran.expired).toBe(2);

    const rows = await stack.db
      .selectFrom('messages')
      .select(['id', 'seq', 'body_text', 'content', 'attachment_id', 'deleted_at'])
      .where('conversation_id', '=', conv)
      .orderBy('seq')
      .execute();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const id of [text.message_id, photo.message_id]) {
      expect(byId[id]).toMatchObject({ body_text: null, content: null, attachment_id: null });
      expect(byId[id]!.deleted_at).not.toBeNull();
    }
    expect(byId[keep.message_id]!.body_text).toBe('this stays');
    // every seq is still there: the timer-change line (1), the two expired messages and the kept one
    expect(rows.map((r) => Number(r.seq))).toEqual(dense(rows.map((r) => Number(r.seq))));

    // sync returns them as tombstones, in place, so a device that was offline sees no hole
    const sync = await stack.call(b, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 50,
    });
    const records = sync.body.events
      .filter((e: any) => e.type === 'new_message')
      .map((e: any) => e.payload.message);
    expect(records.map((r: any) => r.seq)).toEqual(rows.map((r) => Number(r.seq)));
    const tomb = records.find((r: any) => r.message_id === text.message_id);
    expect(tomb.content).toBeNull();
    expect(tomb.deleted_at).not.toBeNull();
    // and the file that was in the photo is no longer reachable
    expect((await stack.call(b, 'GET', `/media/${file}/url`)).status).toBeGreaterThanOrEqual(400);
    const last = await stack.call(b, 'GET', '/conversations');
    expect(last.body.items[0].last_message.content).toEqual({ type: 'text', text: 'this stays' });
  });

  it('a message is only given an expiry when the chat has a timer, and changing the timer does not touch old messages', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const plain = (await send(stack, a, conv, { type: 'text', text: 'before' })).body;
    await stack.call(a, 'PATCH', `/conversations/${conv}`, {
      settings: { disappearing_timer_s: 604_800 },
    });
    const timed = (await send(stack, a, conv, { type: 'text', text: 'after' })).body;
    await stack.call(b, 'PATCH', `/conversations/${conv}`, {
      settings: { disappearing_timer_s: 0 },
    });
    const later = (await send(stack, a, conv, { type: 'text', text: 'timer off again' })).body;
    const history = await stack.call(b, 'GET', `/conversations/${conv}/messages?limit=100`);
    const expires = Object.fromEntries(
      history.body.items
        .filter((m: any) => m.content?.type === 'text')
        .map((m: any) => [m.message_id, m.expires_at]),
    );
    expect(expires[plain.message_id]).toBeNull();
    expect(expires[timed.message_id]).not.toBeNull();
    expect(expires[later.message_id]).toBeNull();
    const delta =
      new Date(expires[timed.message_id]).getTime() - new Date(timed.created_at).getTime();
    expect(Math.abs(delta - 604_800_000)).toBeLessThan(2_000);
  });

  it('cannot be reacted to, starred-and-read, or edited once expired', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    await stack.call(a, 'PATCH', `/conversations/${conv}`, {
      settings: { disappearing_timer_s: 86_400 },
    });
    const m = (await send(stack, a, conv, { type: 'text', text: 'brief' })).body;
    await sql`UPDATE messages SET expire_at = now() - interval '1 second' WHERE id = ${m.message_id}`.execute(
      stack.db,
    );
    const path = `/conversations/${conv}/messages/${m.message_id}`;
    expect((await stack.call(b, 'PUT', `${path}/reaction`, { emoji: '👍' })).status).toBe(404);
    expect(
      (await stack.call(a, 'PATCH', path, { content: { type: 'text', text: 'late' } })).status,
    ).toBe(404);
    expect((await stack.call(a, 'GET', `${path}/info`)).status).toBe(404);
  });
});

// ------------------------------------------------------------------ view once

describe('view-once', () => {
  async function viewOnce(users: TestUser[]) {
    const [sender] = users;
    const conv =
      users.length === 2
        ? await direct(stack, users[0]!, users[1]!)
        : await group(stack, sender!, users.slice(1));
    const file = await attachment(stack.db, sender!);
    const sent = await send(stack, sender!, conv, {
      type: 'image',
      attachment_id: file,
      width: 2,
      height: 2,
      view_once: true,
    });
    return { conv, id: sent.body.message_id as string };
  }

  it('can be opened once by a recipient; the second open is a 409 and the content is gone from every read path', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const { conv, id } = await viewOnce([a, b]);
    const open = `/conversations/${conv}/messages/${id}/open`;
    const first = await stack.call(b, 'POST', open);
    expect(first.status).toBe(200);
    const second = await stack.call(b, 'POST', open);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('VIEW_ONCE_ALREADY_OPENED');
    for (const path of [`/conversations/${conv}/messages`, `/conversations`]) {
      const res = await stack.call(b, 'GET', path);
      const record = path.endsWith('messages') ? res.body.items[0] : res.body.items[0].last_message;
      expect(record.content, path).toBeNull();
    }
    const sync = await stack.call(b, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 10,
    });
    expect(sync.body.events[0].payload.message.content).toBeNull();
    // the sender still sees their own message, and learns that it was opened
    const mine = await stack.call(a, 'GET', `/conversations/${conv}/messages`);
    expect(mine.body.items[0].content.type).toBe('image');
    expect(mine.body.items[0].viewed).toBe(true);
    expect(
      (await stack.call(b, 'GET', `/conversations/${conv}/messages`)).body.items[0].viewed,
    ).toBe(false);
  });

  it('opened by 10 requests at the same moment: exactly one succeeds', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const { conv, id } = await viewOnce([a, b]);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        stack.call(b, 'POST', `/conversations/${conv}/messages/${id}/open`),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it('is opened separately by every member of a group, and the sender cannot open their own', async () => {
    const [a, b, c] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('c')]);
    const { conv, id } = await viewOnce([a, b, c]);
    const open = `/conversations/${conv}/messages/${id}/open`;
    expect((await stack.call(a, 'POST', open)).status).toBe(403);
    expect((await stack.call(b, 'POST', open)).status).toBe(200);
    // c has not opened it yet and still sees the content
    const cView = await stack.call(c, 'GET', `/conversations/${conv}/messages`);
    expect(cView.body.items[0].content.type).toBe('image');
    expect((await stack.call(c, 'POST', open)).status).toBe(200);
  });

  it('refuses to open a message that is not view-once, and a stranger gets nothing', async () => {
    const [a, b, x] = await Promise.all([stack.user('a'), stack.user('b'), stack.user('x')]);
    const conv = await direct(stack, a, b);
    const plain = (await send(stack, a, conv, { type: 'text', text: 'plain' })).body;
    expect(
      (await stack.call(b, 'POST', `/conversations/${conv}/messages/${plain.message_id}/open`))
        .status,
    ).toBe(404);
    const { conv: c2, id } = await viewOnce([a, b]);
    expect(
      (await stack.call(x, 'POST', `/conversations/${c2}/messages/${id}/open`)).status,
    ).toBeGreaterThanOrEqual(403);
  });
});

// ------------------------------------------------------------------ removed members

describe('a removed member', () => {
  it('receives no live event dispatched after the removal and cannot read or sync afterwards', async () => {
    const [owner, keeper, victim] = await Promise.all([
      stack.user('owner'),
      stack.user('keeper'),
      stack.user('victim'),
    ]);
    const victimPhone = await stack.device(victim);
    const conv = await group(stack, owner, [keeper, victim]);
    const victimLive = await stack.connect(victim);
    const phoneLive = await stack.connect(victimPhone);
    const keeperLive = await stack.connect(keeper);

    const before = (await send(stack, owner, conv, { type: 'text', text: 'before the removal' }))
      .body;
    await waitUntil(
      () => victimLive.messages().some((m) => m.message_id === before.message_id),
      8_000,
      'victim hears the first message',
    );
    await waitForOutboxDrained(stack.db);

    expect(
      (await stack.call(owner, 'DELETE', `/conversations/${conv}/members/${victim.id}`)).status,
    ).toBe(204);
    await waitForOutboxDrained(stack.db);
    const quietFrom = victimLive.events.length;
    const quietFromPhone = phoneLive.events.length;

    // everything a member would be told about: messages, edits, reactions, deletes, receipts, typing
    const after = (await send(stack, owner, conv, { type: 'text', text: 'after the removal' }))
      .body;
    await stack.call(
      keeper,
      'PUT',
      `/conversations/${conv}/messages/${after.message_id}/reaction`,
      { emoji: '👍' },
    );
    await stack.call(owner, 'PATCH', `/conversations/${conv}/messages/${after.message_id}`, {
      content: { type: 'text', text: 'after, edited' },
    });
    await stack.call(keeper, 'POST', `/conversations/${conv}/read`, { seq: after.seq });
    keeperLive.socket.emit('typing_start', { conversation_id: conv });
    await stack.call(
      owner,
      'DELETE',
      `/conversations/${conv}/messages/${after.message_id}?for=everyone`,
    );
    await waitForOutboxDrained(stack.db);
    await waitUntil(
      () => keeperLive.messages().some((m) => m.message_id === after.message_id),
      8_000,
      'keeper hears the message',
    );
    await new Promise((r) => setTimeout(r, 400)); // give a wrong delivery time to show up

    for (const [name, client, from] of [
      ['phone', phoneLive, quietFromPhone],
      ['laptop', victimLive, quietFrom],
    ] as const) {
      const heard = client.events.slice(from).filter((e) => e.name !== 'presence_update');
      const content = heard.filter((e) => e.name !== 'conversation_updated');
      expect(
        content.map((e) => e.name),
        `${name} must hear nothing about the group after the removal`,
      ).toEqual([]);
      expect(JSON.stringify(heard)).not.toContain('after the removal');
    }
    // the only thing they are told: the conversation is gone for them
    const told = victimLive.of('conversation_updated').filter((u) => u.conversation_id === conv);
    expect(told.some((u) => u.conversation === null)).toBe(true);

    // REST and sync agree
    expect(
      (await stack.call(victim, 'GET', `/conversations/${conv}/messages`)).status,
    ).toBeGreaterThanOrEqual(403);
    const sync = await stack.call(victim, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 100,
    });
    expect(sync.body.events).toEqual([]);
    expect(sync.body.removed_conversation_ids).toEqual([conv]);
    const list = await stack.call(victim, 'GET', '/conversations');
    expect(list.body.items.map((i: any) => i.id)).not.toContain(conv);
    // the remaining member is unaffected
    expect(keeperLive.messages().some((m) => m.message_id === after.message_id)).toBe(true);
  });

  it('who is added back hears new messages live again', async () => {
    const [owner, other, member] = await Promise.all([
      stack.user('owner'),
      stack.user('other'),
      stack.user('member'),
    ]);
    const conv = await group(stack, owner, [other, member]);
    await stack.call(owner, 'DELETE', `/conversations/${conv}/members/${member.id}`);
    await stack.call(owner, 'POST', `/conversations/${conv}/members`, { user_ids: [member.id] });
    const live = await stack.connect(member);
    const back = (await send(stack, owner, conv, { type: 'text', text: 'said after return' })).body;
    await waitUntil(
      () => live.messages().some((m) => m.message_id === back.message_id),
      8_000,
      'member hears the new message',
    );
  });
});

describe('the id space', () => {
  it('uses UUIDs for message ids and keeps client_message_id private to the sender', async () => {
    const [a, b] = await Promise.all([stack.user('a'), stack.user('b')]);
    const conv = await direct(stack, a, b);
    const id = cmid();
    const sent = await stack.call(a, 'POST', `/conversations/${conv}/messages`, {
      client_message_id: id,
      content: { type: 'text', text: 'x' },
    });
    expect(sent.body.message_id).toMatch(/^[0-9a-f-]{36}$/);
    const mine = await stack.call(a, 'GET', `/conversations/${conv}/messages`);
    const theirs = await stack.call(b, 'GET', `/conversations/${conv}/messages`);
    expect(mine.body.items[0].client_message_id).toBe(id);
    expect(theirs.body.items[0].client_message_id).toBeNull();
  });
});
