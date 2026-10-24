import { sql } from 'kysely';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { FLICK_BOT_USER_ID } from '../src/bot.js';
import { DEMO_USERNAMES, SCALES, seed } from '../src/seed.js';
import { createTestDatabase, type TestDatabase } from './helpers.js';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.destroy();
});

async function counts() {
  const r = await sql<Record<string, number>>`
    SELECT (SELECT count(*) FROM users) AS users,
           (SELECT count(*) FROM conversations) AS conversations,
           (SELECT count(*) FROM conversation_members) AS members,
           (SELECT count(*) FROM messages) AS messages
  `.execute(t.db);
  return r.rows[0]!;
}

it('the small seed is consistent and can be re-run', async () => {
  await seed(t.db, t.pool, 'small');
  const first = await counts();
  expect(first.users).toBe(SCALES.small.users + 1); // + the Flick bot
  expect(first.messages).toBe(SCALES.small.messages);

  // Every conversation's seqs are exactly 1..last_seq.
  const broken = await sql`
    SELECT c.id FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id, c.last_seq
    HAVING count(m.id) <> c.last_seq OR COALESCE(max(m.seq), 0) <> c.last_seq
  `.execute(t.db);
  expect(broken.rows).toEqual([]);

  const demo = await t.db
    .selectFrom('users')
    .select('username')
    .where('username', 'in', [...DEMO_USERNAMES])
    .execute();
  expect(demo).toHaveLength(DEMO_USERNAMES.length);

  const bot = await t.db
    .selectFrom('users')
    .select('is_bot')
    .where('id', '=', FLICK_BOT_USER_ID)
    .executeTakeFirstOrThrow();
  expect(bot.is_bot).toBe(true);

  await seed(t.db, t.pool, 'small');
  expect(await counts()).toEqual(first);
}, 120_000);
