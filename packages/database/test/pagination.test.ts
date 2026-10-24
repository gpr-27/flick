import { randomUUID } from 'node:crypto';

import { sql, type Compilable } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildChatListQuery } from '../src/queries/conversations.js';
import {
  allocateSeqAndInsertMessage,
  buildHistoryQuery,
  keysetHistory,
  searchMessages,
} from '../src/queries/messages.js';
import { buildOutboxClaimQuery } from '../src/queries/outbox.js';
import { createTestDatabase, makeConversation, makeUser, type TestDatabase } from './helpers.js';

let t: TestDatabase;
let alice: Awaited<ReturnType<typeof makeUser>>;
let busy: string;
const PER_CONVERSATION = 200;

// Enough data that the planner prefers indexes, as it would in production: 300 conversations
// x 200 messages, 50k other conversations,
// 2,000 extra users in the groups, and 50k already-published outbox rows.
beforeAll(async () => {
  t = await createTestDatabase();
  alice = await makeUser(t.db, { username: 'alice_p' });
  const bob = await makeUser(t.db, { username: 'bob_p' });
  await sql`INSERT INTO users (username, display_name) SELECT 'filler_' || g, 'Filler ' || g FROM generate_series(1, 2000) g`.execute(
    t.db,
  );
  await sql`
    INSERT INTO conversations (type, name, last_seq, last_message_at)
    SELECT 'group', 'Group ' || g, ${PER_CONVERSATION}, now() - g * interval '1 minute' FROM generate_series(1, 300) g
  `.execute(t.db);
  await sql`
    INSERT INTO conversation_members (conversation_id, user_id, read_seq)
    SELECT c.id, u.id, ${PER_CONVERSATION - 5} FROM conversations c CROSS JOIN (VALUES (${alice.id}::uuid), (${bob.id}::uuid)) u(id)
  `.execute(t.db);
  await sql`
    INSERT INTO conversation_members (conversation_id, user_id, left_at)
    SELECT c.id, u.id, CASE WHEN random() < 0.2 THEN now() END
    FROM conversations c JOIN users u ON u.username LIKE 'filler_%' AND random() < 0.03
  `.execute(t.db);
  await sql`
    INSERT INTO messages (conversation_id, seq, sender_id, type, body_text)
    SELECT c.id, s, ${alice.id}, 'text',
           (ARRAY['hello there', 'lunch at noon?', 'see the roadmap doc', 'ship it'])[1 + s % 4] || ' #' || s
    FROM conversations c CROSS JOIN generate_series(1, ${PER_CONVERSATION}) s
  `.execute(t.db);
  await sql`INSERT INTO conversations (type, name) SELECT 'group', 'Other ' || g FROM generate_series(1, 50000) g`.execute(
    t.db,
  );
  await sql`
    INSERT INTO outbox (topic, partition_key, payload, published_at)
    SELECT 'chat.message.v1', 'k', '{}', now() FROM generate_series(1, 50000)
  `.execute(t.db);
  await sql`INSERT INTO outbox (topic, partition_key, payload) SELECT 'chat.message.v1', 'k', '{}' FROM generate_series(1, 5)`.execute(
    t.db,
  );
  busy = (
    await t.db
      .selectFrom('conversation_members')
      .select('conversation_id')
      .where('user_id', '=', alice.id)
      .executeTakeFirstOrThrow()
  ).conversation_id;
  await sql`VACUUM ANALYZE`.execute(t.db);
}, 180_000);

afterAll(async () => {
  await t.destroy();
});

describe('keyset pagination', () => {
  it('scrolling back pages through the whole history exactly once, newest first', async () => {
    const seen: number[] = [];
    let cursor: number | null = null;
    do {
      const page: Awaited<ReturnType<typeof keysetHistory>> = await keysetHistory(t.db, {
        conversationId: busy,
        direction: 'backward',
        cursor,
        limit: 37,
      });
      seen.push(...page.messages.map((m) => m.seq));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(Array.from({ length: PER_CONVERSATION }, (_, i) => PER_CONVERSATION - i));
  });

  it('sync misses nothing when new messages arrive while it is running', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const send = () =>
      allocateSeqAndInsertMessage(t.db, {
        conversationId: conv,
        senderId: u.id,
        senderDeviceId: u.deviceId,
        clientMessageId: randomUUID(),
        type: 'text',
        bodyText: 'hi',
      });
    for (let i = 0; i < 25; i++) await send();

    const seen: number[] = [];
    let cursor = 0;
    for (;;) {
      const page = await keysetHistory(t.db, {
        conversationId: conv,
        direction: 'forward',
        cursor,
        limit: 10,
      });
      seen.push(...page.messages.map((m) => m.seq));
      if (seen.length === 10) for (let i = 0; i < 7; i++) await send(); // live traffic mid-sync
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
  });

  it('returns deleted messages as tombstones so every device learns about the delete', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', [{ userId: u.id }]);
    const { message } = await allocateSeqAndInsertMessage(t.db, {
      conversationId: conv,
      senderId: u.id,
      senderDeviceId: u.deviceId,
      clientMessageId: randomUUID(),
      type: 'text',
      bodyText: 'oops',
    });
    await t.db
      .updateTable('messages')
      .set({ deleted_at: new Date(), body_text: null })
      .where('id', '=', message.id)
      .execute();
    const page = await keysetHistory(t.db, { conversationId: conv, direction: 'forward' });
    expect(page.messages[0]!.deleted_at).toBeInstanceOf(Date);
    expect(page.messages[0]!.body_text).toBeNull();
  });

  it('the chat list shows unread counts computed from cursors', async () => {
    const chats = await buildChatListQuery(t.db, alice.id).execute();
    expect(chats).toHaveLength(300);
    expect(chats.every((c) => c.unread_count === 5)).toBe(true);
  });

  it('search only returns messages from conversations the user is in', async () => {
    const outsider = await makeUser(t.db);
    const hits = await searchMessages(t.db, alice.id, 'roadmap', 10);
    expect(hits).toHaveLength(10);
    expect(hits.every((h) => h.body_text!.includes('roadmap'))).toBe(true);
    expect(await searchMessages(t.db, outsider.id, 'roadmap')).toEqual([]);
  });
});

// Runs EXPLAIN on a query and returns the names of the indexes and plan nodes it uses.
async function plan(query: Compilable): Promise<{ indexes: string[]; nodes: string[] }> {
  const { sql: text, parameters } = query.compile();
  const r = await t.pool.query(`EXPLAIN (FORMAT JSON) ${text}`, [...parameters]);
  const indexes: string[] = [];
  const nodes: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o['Index Name'] === 'string') indexes.push(o['Index Name']);
      if (typeof o['Node Type'] === 'string') nodes.push(o['Node Type']);
      Object.values(o).forEach(walk);
    }
  };
  walk((r.rows[0] as Record<string, unknown>)['QUERY PLAN']);
  return { indexes, nodes };
}

describe('EXPLAIN: each query uses the index it was designed for', () => {
  it('history and sync use messages_conversation_seq_uq (no scan, no sort)', async () => {
    for (const input of [
      { conversationId: busy, direction: 'backward' as const },
      { conversationId: busy, direction: 'backward' as const, cursor: 120 },
      { conversationId: busy, direction: 'forward' as const, cursor: 100 },
    ]) {
      const { indexes, nodes } = await plan(buildHistoryQuery(t.db, input, 50));
      expect(indexes).toContain('messages_conversation_seq_uq');
      expect(nodes).not.toContain('Seq Scan');
      expect(nodes).not.toContain('Sort');
    }
  });

  it('the outbox claim uses the partial outbox_unpublished_idx', async () => {
    const { indexes, nodes } = await plan(buildOutboxClaimQuery(t.db, 100));
    expect(indexes).toContain('outbox_unpublished_idx');
    expect(nodes).not.toContain('Seq Scan');
  });

  it('fan-out uses conversation_members_active_idx', async () => {
    const q = t.db
      .selectFrom('conversation_members')
      .select(['user_id', 'role'])
      .where('conversation_id', '=', busy)
      .where('left_at', 'is', null);
    expect((await plan(q)).indexes).toContain('conversation_members_active_idx');
  });

  it('the chat list uses conversation_members_user_idx and the conversations primary key', async () => {
    const { indexes, nodes } = await plan(buildChatListQuery(t.db, alice.id));
    expect(indexes).toContain('conversation_members_user_idx');
    expect(indexes).toContain('conversations_pkey');
    expect(nodes).not.toContain('Seq Scan');
  });

  it('search uses the GIN index messages_search_idx', async () => {
    const q = t.db
      .selectFrom('messages')
      .select('id')
      .where(sql<boolean>`search @@ websearch_to_tsquery('simple', 'roadmap')`);
    expect((await plan(q)).indexes).toContain('messages_search_idx');
  });
});
