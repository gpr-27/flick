/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, no-unsafe-optional-chaining --
   the tests read JSON response bodies without declaring a type for each one */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db.js';
import {
  acknowledgeDelivered,
  acknowledgeRead,
  sendMessage,
  syncConversation,
  syncMany,
  toApiError,
} from '../../src/modules/messages/index.js';
import {
  asUser,
  createTestApp,
  createTestDb,
  headers,
  makeConversation,
  makeUser,
  text,
  type TestUser,
} from './messages-helpers.js';

let db: Db;
let destroy: () => Promise<void>;
let app: Awaited<ReturnType<typeof createTestApp>>;
const deps = () => ({ db });

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  destroy = t.destroy;
  app = await createTestApp(db, t.url);
});

afterAll(async () => {
  await app.close();
  await destroy();
});

const send = (user: TestUser, conversationId: string, body: string, id?: string) =>
  sendMessage(deps(), asUser(user), {
    conversation_id: conversationId,
    client_message_id: id ?? `cmid_${crypto.randomUUID()}`,
    content: text(body),
  });

async function twoPeople() {
  const alice = await makeUser(db, 'alice');
  const bob = await makeUser(db, 'bob');
  const conv = await makeConversation(db, 'direct', [{ user: alice }, { user: bob }]);
  return { alice, bob, conv };
}

async function api(
  user: TestUser,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  const res = await app.inject({ method, url, headers: headers(user), payload });
  return {
    status: res.statusCode,
    body: res.body ? (JSON.parse(res.body) as Record<string, any>) : null,
  };
}

describe('sending and idempotency', () => {
  it('a retried client_message_id returns the same message and seq', async () => {
    const { alice, conv } = await twoPeople();
    const first = await send(alice, conv, 'hello', 'cmid_retry_1');
    const second = await send(alice, conv, 'hello', 'cmid_retry_1');
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ ...first, duplicate: true });
    const count = await db
      .selectFrom('messages')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('conversation_id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(count.n).toBe(1);
  });

  it('25 concurrent sends of the same client_message_id create one message and one seq', async () => {
    const { alice, conv } = await twoPeople();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => send(alice, conv, 'once', 'cmid_concurrent_1')),
    );
    expect(new Set(results.map((r) => r.message_id)).size).toBe(1);
    expect(new Set(results.map((r) => r.seq))).toEqual(new Set([1]));
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    const conversation = await db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(conversation.last_seq).toBe(1); // the losers rolled back their seq: no gap
    const outbox = await db
      .selectFrom('outbox')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('partition_key', '=', conv)
      .executeTakeFirstOrThrow();
    expect(outbox.n).toBe(1);
  });

  it('concurrent sends from many senders get unique, contiguous seqs', async () => {
    const people = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeUser(db, `s${String(i)}`)),
    );
    const conv = await makeConversation(
      db,
      'group',
      people.map((user) => ({ user })),
    );
    const results = await Promise.all(
      people.flatMap((p) => Array.from({ length: 6 }, (_, i) => send(p, conv, `m${String(i)}`))),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  it('a non-member cannot send or read', async () => {
    const { conv } = await twoPeople();
    const mallory = await makeUser(db, 'mallory');
    await expect(send(mallory, conv, 'let me in')).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    expect((await api(mallory, 'GET', `/conversations/${conv}/messages`)).status).toBe(403);
    expect((await api(mallory, 'GET', `/conversations/${conv}/sync`)).status).toBe(403);
  });

  it('rejects server-only content, a reply to another conversation, and view-once text', async () => {
    const { alice, conv } = await twoPeople();
    const other = await twoPeople();
    const elsewhere = await send(other.alice, other.conv, 'elsewhere');
    const base = { conversation_id: conv, client_message_id: 'cmid_bad_one_1' };
    await expect(
      sendMessage(deps(), asUser(alice), {
        ...base,
        content: { type: 'text', text: 'x', reply_to: elsewhere.message_id },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      sendMessage(deps(), asUser(alice), {
        ...base,
        content: { type: 'text', text: 'x', view_once: true },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      sendMessage(deps(), asUser(alice), {
        ...base,
        content: { type: 'system', event: 'renamed', actor_user_id: alice.id, target_user_ids: [] },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('works over REST too, and a blocked sender gets BLOCKED', async () => {
    const { alice, bob, conv } = await twoPeople();
    const body = { client_message_id: 'cmid_rest_0001', content: text('hi') };
    const res = await api(alice, 'POST', `/conversations/${conv}/messages`, body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ seq: 1, duplicate: false });
    await db.insertInto('blocks').values({ blocker_id: bob.id, blocked_id: alice.id }).execute();
    const blocked = await api(alice, 'POST', `/conversations/${conv}/messages`, {
      ...body,
      client_message_id: 'cmid_rest_0002',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body?.error.code).toBe('BLOCKED');
  });

  it('sets expire_at when the conversation has a disappearing timer', async () => {
    const alice = await makeUser(db, 'alice');
    const conv = await makeConversation(db, 'group', [{ user: alice }], {
      disappearing_seconds: 86_400,
    });
    const accepted = await send(alice, conv, 'poof');
    const row = await db
      .selectFrom('messages')
      .select('expire_at')
      .where('id', '=', accepted.message_id)
      .executeTakeFirstOrThrow();
    expect(row.expire_at).not.toBeNull();
  });
});

describe('history', () => {
  it('pages are stable while new messages keep arriving', async () => {
    const { alice, conv } = await twoPeople();
    for (let i = 1; i <= 30; i++) await send(alice, conv, `m${String(i)}`);
    const page1 = await api(alice, 'GET', `/conversations/${conv}/messages?limit=10`);
    expect(page1.body?.items.map((m: { seq: number }) => m.seq)).toEqual([
      30, 29, 28, 27, 26, 25, 24, 23, 22, 21,
    ]);
    for (let i = 0; i < 5; i++) await send(alice, conv, 'late');
    const page2 = await api(
      alice,
      'GET',
      `/conversations/${conv}/messages?limit=10&before_seq=${String(page1.body?.next_cursor)}`,
    );
    expect(page2.body?.items.map((m: { seq: number }) => m.seq)).toEqual([
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11,
    ]);
  });

  it('shows tombstones, hides deleted-for-me, and never returns expired messages', async () => {
    const { alice, bob, conv } = await twoPeople();
    const gone = await send(alice, conv, 'delete me for everyone');
    const mine = await send(alice, conv, 'hide me from bob');
    const expiring = await send(alice, conv, 'timer');
    await send(alice, conv, 'visible');
    await api(alice, 'DELETE', `/conversations/${conv}/messages/${gone.message_id}?for=everyone`);
    await api(bob, 'DELETE', `/conversations/${conv}/messages/${mine.message_id}?for=me`);
    await db
      .updateTable('messages')
      .set({ expire_at: sql<Date>`now() - interval '1 second'` })
      .where('id', '=', expiring.message_id)
      .execute();

    const bobSees = await api(bob, 'GET', `/conversations/${conv}/messages`);
    const items = bobSees.body?.items as {
      message_id: string;
      content: unknown;
      deleted_at: string | null;
    }[];
    expect(items.map((m) => m.message_id)).not.toContain(mine.message_id);
    expect(items.map((m) => m.message_id)).not.toContain(expiring.message_id);
    const tombstone = items.find((m) => m.message_id === gone.message_id)!;
    expect(tombstone.content).toBeNull();
    expect(tombstone.deleted_at).not.toBeNull();
    const aliceSees = await api(alice, 'GET', `/conversations/${conv}/messages`);
    expect(aliceSees.body?.items.map((m: { message_id: string }) => m.message_id)).toContain(
      mine.message_id,
    );
  });

  it('hides a view-once message after the recipient opens it', async () => {
    const { alice, bob, conv } = await twoPeople();
    const att = await db
      .insertInto('attachments')
      .values({
        owner_id: alice.id,
        object_key: `k/${crypto.randomUUID()}`,
        declared_mime: 'image/png',
        size_bytes: 10,
        sha256: Buffer.from('x'),
        status: 'uploaded',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const sent = await sendMessage(deps(), asUser(alice), {
      conversation_id: conv,
      client_message_id: 'cmid_viewonce_1',
      content: { type: 'image', attachment_id: att.id, width: 10, height: 10, view_once: true },
    });
    const before = await api(bob, 'GET', `/conversations/${conv}/messages`);
    expect(before.body?.items[0].content).not.toBeNull();
    expect((await api(alice, 'GET', `/conversations/${conv}/messages`)).body?.items[0].viewed).toBe(
      false,
    );
    expect(
      (await api(bob, 'POST', `/conversations/${conv}/messages/${sent.message_id}/open`)).status,
    ).toBe(200);
    const again = await api(bob, 'POST', `/conversations/${conv}/messages/${sent.message_id}/open`);
    expect(again.body?.error.code).toBe('VIEW_ONCE_ALREADY_OPENED');
    const after = await api(bob, 'GET', `/conversations/${conv}/messages`);
    expect(after.body?.items[0].content).toBeNull();
    const senderView = await api(alice, 'GET', `/conversations/${conv}/messages`);
    expect(senderView.body?.items[0].content).not.toBeNull();
    // Only the sender learns that it was opened.
    expect(senderView.body?.items[0].viewed).toBe(true);
    expect(after.body?.items[0].viewed).toBe(false);
  });
});

describe('edit, delete, react and sync', () => {
  it('sync returns messages, edits, reactions and deletes in seq order, with no holes', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m1 = await send(alice, conv, 'first');
    const m2 = await send(alice, conv, 'second');
    await api(alice, 'PATCH', `/conversations/${conv}/messages/${m1.message_id}`, {
      content: text('first (edited)'),
    });
    await api(bob, 'PUT', `/conversations/${conv}/messages/${m1.message_id}/reaction`, {
      emoji: '👍',
    });
    await api(alice, 'DELETE', `/conversations/${conv}/messages/${m2.message_id}?for=everyone`);

    const sync = await api(bob, 'GET', `/conversations/${conv}/sync?after_seq=0`);
    expect(sync.body?.has_more).toBe(false);
    const events = sync.body?.events as {
      type: string;
      payload: { seq?: number; message?: { seq: number } };
    }[];
    expect(events.map((e) => e.type)).toEqual([
      'new_message',
      'new_message',
      'message_edited',
      'reaction_added',
      'message_deleted',
    ]);
    expect(events.map((e) => e.payload.seq ?? e.payload.message?.seq)).toEqual([1, 2, 3, 4, 5]);
    // after a cursor, only newer events come back
    const later = await api(bob, 'GET', `/conversations/${conv}/sync?after_seq=3`);
    expect(later.body?.events.map((e: { type: string }) => e.type)).toEqual([
      'reaction_added',
      'message_deleted',
    ]);
  });

  it('pages through sync with has_more while messages keep arriving', async () => {
    const { alice, conv } = await twoPeople();
    for (let i = 0; i < 7; i++) await send(alice, conv, `m${String(i)}`);
    const seen: number[] = [];
    let after = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = await syncConversation(deps(), asUser(alice), {
        conversationId: conv,
        afterSeq: after,
        limit: 3,
      });
      seen.push(
        ...page.events.map((e) =>
          e.type === 'new_message' ? e.payload.message.seq : e.payload.seq,
        ),
      );
      if (guard === 0) await send(alice, conv, 'arrives mid-sync');
      after = page.lastSeq;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('POST /sync style request pages across conversations and reports left ones', async () => {
    const { alice, bob, conv } = await twoPeople();
    const other = await makeConversation(db, 'group', [{ user: alice }]);
    const left = await makeConversation(db, 'group', [{ user: bob }]);
    for (let i = 0; i < 3; i++) await send(alice, conv, `a${String(i)}`);
    await send(alice, other, 'b');
    const request = {
      cursors: [
        { conversation_id: conv, after_seq: 0 },
        { conversation_id: other, after_seq: 0 },
        { conversation_id: left, after_seq: 0 },
      ],
      limit: 2,
    };
    const first = await syncMany(deps(), asUser(alice), request);
    expect(first.events).toHaveLength(2);
    expect(first.next_cursor).not.toBeNull();
    const second = await syncMany(deps(), asUser(alice), {
      ...request,
      cursor: first.next_cursor!,
    });
    expect(second.events).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
    expect(second.removed_conversation_ids).toEqual([left]);
  });

  it('only the sender can edit, and only within 15 minutes', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m = await send(alice, conv, 'typo');
    const url = `/conversations/${conv}/messages/${m.message_id}`;
    expect((await api(bob, 'PATCH', url, { content: text('hax') })).status).toBe(403);
    expect((await api(alice, 'PATCH', url, { content: text('fixed') })).status).toBe(204);
    await db
      .updateTable('messages')
      .set({ created_at: sql<Date>`now() - interval '16 minutes'` })
      .where('id', '=', m.message_id)
      .execute();
    const late = await api(alice, 'PATCH', url, { content: text('too late') });
    expect(late.status).toBe(409);
    expect(late.body?.error.code).toBe('EDIT_WINDOW_EXPIRED');
  });

  it('delete for everyone: sender or group admin; a plain member is refused; a retry takes no new seq', async () => {
    const owner = await makeUser(db, 'owner');
    const member = await makeUser(db, 'member');
    const other = await makeUser(db, 'other');
    const conv = await makeConversation(db, 'group', [
      { user: owner, role: 'owner' },
      { user: member },
      { user: other },
    ]);
    const m1 = await send(member, conv, 'mine');
    const m2 = await send(member, conv, 'also mine');
    expect(
      (await api(other, 'DELETE', `/conversations/${conv}/messages/${m1.message_id}?for=everyone`))
        .status,
    ).toBe(403);
    expect(
      (await api(owner, 'DELETE', `/conversations/${conv}/messages/${m1.message_id}?for=everyone`))
        .status,
    ).toBe(204);
    expect(
      (await api(member, 'DELETE', `/conversations/${conv}/messages/${m2.message_id}?for=everyone`))
        .status,
    ).toBe(204);
    await api(member, 'DELETE', `/conversations/${conv}/messages/${m2.message_id}?for=everyone`);
    const c = await db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(c.last_seq).toBe(4); // 2 messages + 2 deletes
    const row = await db
      .selectFrom('messages')
      .select(['body_text', 'deleted_at'])
      .where('id', '=', m1.message_id)
      .executeTakeFirstOrThrow();
    expect(row.body_text).toBeNull();
    expect(row.deleted_at).not.toBeNull();
  });

  it('delete for me takes no seq', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m = await send(alice, conv, 'x');
    await api(bob, 'DELETE', `/conversations/${conv}/messages/${m.message_id}?for=me`);
    const c = await db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(c.last_seq).toBe(1);
  });

  it('one reaction per user: a new emoji replaces the old, the same one is a no-op, removal takes a seq', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m = await send(alice, conv, 'react to me');
    const url = `/conversations/${conv}/messages/${m.message_id}/reaction`;
    await api(bob, 'PUT', url, { emoji: '👍' });
    await api(bob, 'PUT', url, { emoji: '👍' });
    await api(bob, 'PUT', url, { emoji: '❤️' });
    const rows = await db
      .selectFrom('reactions')
      .select('emoji')
      .where('message_id', '=', m.message_id)
      .execute();
    expect(rows.map((r) => r.emoji)).toEqual(['❤️']);
    await api(bob, 'DELETE', url);
    const c = await db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(c.last_seq).toBe(4); // message, 👍, ❤️, removal
    const outbox = await db
      .selectFrom('outbox')
      .select('payload')
      .where('partition_key', '=', conv)
      .orderBy('id')
      .execute();
    expect(outbox.map((o) => o.payload.type)).toEqual([
      'message.created',
      'reaction.added',
      'reaction.added',
      'reaction.removed',
    ]);
  });
});

describe('receipts', () => {
  it('delivery and read cursors never move backwards and are capped at last_seq', async () => {
    const { alice, bob, conv } = await twoPeople();
    for (let i = 0; i < 5; i++) await send(alice, conv, `m${String(i)}`);
    const delivered = async (seq: number) => {
      await acknowledgeDelivered(deps(), asUser(bob), [{ conversationId: conv, seq }]);
      const c = await db
        .selectFrom('device_cursors')
        .select('delivered_seq')
        .where('device_id', '=', bob.deviceId)
        .where('conversation_id', '=', conv)
        .executeTakeFirstOrThrow();
      return c.delivered_seq;
    };
    expect(await delivered(4)).toBe(4);
    expect(await delivered(2)).toBe(4); // a late, older ack changes nothing
    expect(await delivered(999)).toBe(5); // cannot claim messages that do not exist
    expect(
      (await acknowledgeRead(deps(), asUser(bob), { conversationId: conv, seq: 3 })).readSeq,
    ).toBe(3);
    expect(
      (await acknowledgeRead(deps(), asUser(bob), { conversationId: conv, seq: 1 })).readSeq,
    ).toBe(3);
    // a repeat that moves nothing writes no receipt event
    const events = await db
      .selectFrom('outbox')
      .select('payload')
      .where('topic', '=', 'chat.receipt.v1')
      .where('partition_key', '=', conv)
      .execute();
    expect(events.map((e) => e.payload.type)).toEqual([
      'receipt.delivered',
      'receipt.delivered',
      'receipt.read',
    ]);
  });

  it('a user who left the conversation cannot advance a read cursor', async () => {
    const { alice, conv } = await twoPeople();
    const stranger = await makeUser(db, 'stranger');
    await expect(
      acknowledgeRead(deps(), asUser(stranger), { conversationId: conv, seq: 1 }),
    ).rejects.toSatisfy((e) => toApiError(e).code === 'NOT_A_MEMBER');
    await send(alice, conv, 'x');
  });

  it('message info shows who received and who read, for the sender only', async () => {
    const alice = await makeUser(db, 'alice');
    const bob = await makeUser(db, 'bob');
    const carol = await makeUser(db, 'carol');
    const conv = await makeConversation(db, 'group', [
      { user: alice },
      { user: bob },
      { user: carol },
    ]);
    const m = await send(alice, conv, 'info');
    await acknowledgeDelivered(deps(), asUser(bob), [{ conversationId: conv, seq: m.seq }]);
    await acknowledgeRead(deps(), asUser(carol), { conversationId: conv, seq: m.seq });
    const info = await api(alice, 'GET', `/conversations/${conv}/messages/${m.message_id}/info`);
    const byUser = Object.fromEntries(
      (info.body?.recipients as { user_id: string; delivered: boolean; read: boolean }[]).map(
        (r) => [r.user_id, r],
      ),
    );
    expect(byUser[bob.id]).toMatchObject({ delivered: true, read: false });
    expect(byUser[carol.id]).toMatchObject({ delivered: true, read: true });
    expect(
      (await api(bob, 'GET', `/conversations/${conv}/messages/${m.message_id}/info`)).status,
    ).toBe(403);
  });
});

describe('read receipts setting', () => {
  it('hides "read" in message info when either side turned read receipts off', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m = await send(alice, conv, 'secret ticks');
    await acknowledgeRead(deps(), asUser(bob), { conversationId: conv, seq: m.seq });
    const readOf = async (): Promise<boolean> => {
      const info = await api(alice, 'GET', `/conversations/${conv}/messages/${m.message_id}/info`);
      return (info.body?.recipients as { read: boolean }[])[0]!.read;
    };
    expect(await readOf()).toBe(true);

    await api(bob, 'PATCH', '/users/me/privacy', { read_receipts: false });
    expect(await readOf()).toBe(false);
    await api(bob, 'PATCH', '/users/me/privacy', { read_receipts: true });
    await api(alice, 'PATCH', '/users/me/privacy', { read_receipts: false });
    expect(await readOf()).toBe(false);
  });
});

describe('pins, stars, polls', () => {
  it('pin, star and unstar', async () => {
    const { alice, bob, conv } = await twoPeople();
    const m = await send(alice, conv, 'important');
    await api(bob, 'POST', `/conversations/${conv}/pins`, { message_id: m.message_id });
    expect((await api(alice, 'GET', `/conversations/${conv}/pins`)).body?.items).toHaveLength(1);
    await api(bob, 'PUT', `/conversations/${conv}/messages/${m.message_id}/star`);
    expect((await api(bob, 'GET', '/starred')).body?.items).toHaveLength(1);
    expect((await api(alice, 'GET', '/starred')).body?.items).toHaveLength(0);
    await api(bob, 'DELETE', `/conversations/${conv}/messages/${m.message_id}/star`);
    expect((await api(bob, 'GET', '/starred')).body?.items).toHaveLength(0);
  });

  it('a new vote replaces the old one and the tally is computed on read', async () => {
    const { alice, bob, conv } = await twoPeople();
    const poll = await sendMessage(deps(), asUser(alice), {
      conversation_id: conv,
      client_message_id: 'cmid_poll_0001',
      content: {
        type: 'poll',
        question: 'Lunch?',
        options: ['Pizza', 'Sushi'],
        allow_multiple: false,
      },
    });
    const url = `/conversations/${conv}/polls/${poll.message_id}`;
    await api(bob, 'POST', `${url}/vote`, { option_indexes: [0] });
    const tally = await api(bob, 'POST', `${url}/vote`, { option_indexes: [1] });
    expect(tally.body?.options.map((o: { voter_ids: string[] }) => o.voter_ids.length)).toEqual([
      0, 1,
    ]);
    expect((await api(bob, 'POST', `${url}/vote`, { option_indexes: [0, 1] })).status).toBe(400);
    expect((await api(bob, 'POST', `${url}/vote`, { option_indexes: [5] })).status).toBe(400);
  });
});

describe('search', () => {
  it('never returns messages from conversations the caller is not in, or has left', async () => {
    const alice = await makeUser(db, 'alice');
    const bob = await makeUser(db, 'bob');
    const eve = await makeUser(db, 'eve');
    const secret = await makeConversation(db, 'direct', [{ user: alice }, { user: bob }]);
    const evesChat = await makeConversation(db, 'group', [{ user: eve }, { user: bob }]);
    await send(alice, secret, 'the zebra password is hunter2');
    await send(eve, evesChat, 'my zebra stories');
    const found = await api(eve, 'GET', '/search?q=zebra');
    expect(found.body?.items).toHaveLength(1);
    expect(found.body?.items[0].message.conversation_id).toBe(evesChat);
    // scoping to a conversation she is not in is refused outright
    expect((await api(eve, 'GET', `/search?q=zebra&conversation_id=${secret}`)).status).toBe(403);
    // leaving removes access to old messages in search
    await db
      .updateTable('conversation_members')
      .set({ left_at: sql<Date>`now()` })
      .where('conversation_id', '=', evesChat)
      .where('user_id', '=', eve.id)
      .execute();
    expect((await api(eve, 'GET', '/search?q=zebra')).body?.items).toHaveLength(0);
  });

  it('marks hits and escapes everything else in the snippet', async () => {
    const { alice, conv } = await twoPeople();
    await send(alice, conv, 'look at <script>alert(1)</script> giraffe');
    const found = await api(alice, 'GET', '/search?q=giraffe');
    const snippet = found.body?.items[0].snippet as string;
    expect(snippet).toContain('<mark>giraffe</mark>');
    expect(snippet).not.toContain('<script>');
  });

  it('pages with a cursor', async () => {
    const { alice, conv } = await twoPeople();
    for (let i = 0; i < 5; i++) await send(alice, conv, `okapi ${String(i)}`);
    const p1 = await api(alice, 'GET', '/search?q=okapi&limit=2');
    const p2 = await api(
      alice,
      'GET',
      `/search?q=okapi&limit=2&cursor=${String(p1.body?.next_cursor)}`,
    );
    const ids = [...p1.body?.items, ...p2.body?.items].map(
      (h: { message: { message_id: string } }) => h.message.message_id,
    );
    expect(new Set(ids).size).toBe(4);
  });
});
