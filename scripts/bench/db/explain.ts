// Saves EXPLAIN (ANALYZE, BUFFERS) for each important query shape, using the SQL and parameters
// that the real @chat/db helpers send (captured from Kysely's query log).
//
//   DATABASE_URL=postgres://... npx tsx scripts/bench/db/explain.ts [out-dir]
import { mkdirSync, writeFileSync } from 'node:fs';

import {
  advanceReadSeq,
  buildOutboxClaimQuery,
  createPool,
  keysetHistory,
  recipientCursors,
  searchMessages,
  type Database,
} from '@chat/db';
import { Kysely, PostgresDialect, sql } from 'kysely';

import { loadFixtures } from './fixtures.js';

const OUT = process.argv[2] ?? 'docs/performance/query-plans';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const pool = createPool({ connectionString: url, max: 5 });
let captured: { sql: string; parameters: readonly unknown[] } | undefined;
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
  log: (e) => {
    if (e.level === 'query') captured = { sql: e.query.sql, parameters: e.query.parameters };
  },
});

// Runs `fn` (which calls a real helper once) and returns the SQL it sent.
async function capture(fn: () => Promise<unknown>) {
  captured = undefined;
  await fn();
  if (!captured) throw new Error('no query captured');
  return captured;
}

async function save(
  name: string,
  title: string,
  q: { sql: string; parameters: readonly unknown[] },
) {
  const client = await pool.connect();
  try {
    // Inside a transaction that is rolled back, so FOR UPDATE and writes leave nothing behind.
    await client.query('BEGIN');
    const explain = `EXPLAIN (ANALYZE, BUFFERS, SETTINGS) ${q.sql}`;
    await client.query(explain, [...q.parameters]); // first run warms the cache
    const res = await client.query<{ 'QUERY PLAN': string }>(explain, [...q.parameters]);
    await client.query('ROLLBACK');
    const plan = res.rows.map((r) => r['QUERY PLAN']).join('\n');
    const header =
      `-- ${title}\n-- run: ${new Date().toISOString()} (second execution, warm cache)\n` +
      `-- parameters: ${JSON.stringify(q.parameters)}\n\n${q.sql}\n\n`;
    writeFileSync(`${OUT}/${name}.txt`, `${header}${plan}\n`);
    console.log(`${name}: ${/Execution Time: ([\d.]+) ms/.exec(plan)?.[1]} ms`);
  } finally {
    client.release();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fx = await loadFixtures(db);
  const { hot, bigGroup } = fx;
  const mostConnected = fx.seedUser;
  const manyChats = { id: fx.manyChatsUser };

  await save(
    'history-latest',
    'History: latest 50 messages of the busiest direct chat (keysetHistory, backward)',
    await capture(() =>
      keysetHistory(db, {
        conversationId: hot.conversation_id,
        direction: 'backward',
        limit: 50,
        viewerId: hot.user_id,
      }),
    ),
  );
  await save(
    'history-deep',
    'History: deep keyset page, seq < half of last_seq',
    await capture(() =>
      keysetHistory(db, {
        conversationId: hot.conversation_id,
        direction: 'backward',
        cursor: Math.floor(hot.last_seq / 2),
        limit: 50,
        viewerId: hot.user_id,
      }),
    ),
  );
  await save(
    'history-sync-forward',
    'History: sync after reconnect, 200 rows after seq 1000 (keysetHistory, forward)',
    await capture(() =>
      keysetHistory(db, {
        conversationId: hot.conversation_id,
        direction: 'forward',
        cursor: 1000,
        limit: 200,
        viewerId: hot.user_id,
      }),
    ),
  );
  // The chat list helper is a query builder: capture it by running it.
  const { buildChatListQuery } = await import('@chat/db');
  await save(
    'chat-list-23',
    'Chat list for the seed user with the most chats (23)',
    await capture(() => buildChatListQuery(db, mostConnected.user_id).execute()),
  );
  await save(
    'chat-list-1000',
    'Chat list for a user in 1,000 chats',
    await capture(() => buildChatListQuery(db, manyChats.id).execute()),
  );
  await save(
    'membership-check',
    'Membership check (requireMember)',
    await capture(() =>
      db
        .selectFrom('conversation_members')
        .select(['role', 'read_seq'])
        .where('conversation_id', '=', hot.conversation_id)
        .where('user_id', '=', hot.user_id)
        .where('left_at', 'is', null)
        .executeTakeFirst(),
    ),
  );
  // The dispatcher's normal state is a short queue; plan it with a 10,000-row backlog.
  await sql`TRUNCATE outbox`.execute(db);
  await sql`INSERT INTO outbox (topic, partition_key, payload)
            SELECT 'chat.message.v1', gen_random_uuid()::text, '{"type":"message.created"}'::jsonb
            FROM generate_series(1, 10000)`.execute(db);
  await sql`VACUUM ANALYZE outbox`.execute(db);
  await save(
    'outbox-claim',
    'Outbox claim: 100 oldest unpublished rows, FOR UPDATE SKIP LOCKED (dispatcher)',
    await capture(() => buildOutboxClaimQuery(db, 100).execute()),
  );
  await save(
    'receipts-recipient-cursors',
    'Receipts: recipientCursors for the largest group',
    await capture(() => recipientCursors(db, bigGroup.conversation_id, bigGroup.sender)),
  );
  await save(
    'read-cursor-update',
    'Read cursor update (advanceReadSeq)',
    await capture(() =>
      advanceReadSeq(db, {
        conversationId: hot.conversation_id,
        userId: hot.user_id,
        readSeq: hot.last_seq,
      }),
    ),
  );
  await save(
    'search-common',
    'Search: common word "need" over the chats of the seed user with the most chats (23)',
    await capture(() => searchMessages(db, mostConnected.user_id, 'need', 20)),
  );
  await save(
    'search-common-1000-chats',
    'Search: common word "need" for a user in 1,000 chats',
    await capture(() => searchMessages(db, manyChats.id, 'need', 20)),
  );
  await save(
    'search-rare',
    'Search: rare word "hello"',
    await capture(() => searchMessages(db, mostConnected.user_id, 'hello', 20)),
  );
  await save(
    'search-in-chat',
    'Search: common word inside one chat',
    await capture(() =>
      searchMessages(db, hot.user_id, 'need', 20, { conversationId: hot.conversation_id }),
    ),
  );
  await db.destroy();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
