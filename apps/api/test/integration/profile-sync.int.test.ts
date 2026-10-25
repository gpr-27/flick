import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROFILE_ANNOUNCE_MAX_CONVERSATIONS } from '../../src/modules/users/repo/announce.js';
import {
  createDatabase,
  direct,
  group,
  startStack,
  waitForOutboxDrained,
  waitUntil,
  type Stack,
  type TestDatabase,
} from './harness.js';

// A name, username or picture change reaches everyone who shares a chat with the user, live.

vi.setConfig({ testTimeout: 120_000 });

let database: TestDatabase;
let stack: Stack;

beforeAll(async () => {
  database = await createDatabase('profsync');
  stack = await startStack({ databaseUrl: database.url });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

async function profileEventCount(userId?: string): Promise<number> {
  const { rows } = await sql<{ n: string }>`
    SELECT count(*) AS n FROM outbox
    WHERE payload->>'type' = 'conversation.member_profile_changed'
      ${userId ? sql`AND payload->'data'->>'user_id' = ${userId}` : sql``}`.execute(stack.db);
  return Number(rows[0]!.n);
}

describe('user_updated', () => {
  it('reaches members of every shared chat once, not blocked people and not strangers', async () => {
    const [a, b, c, d, e] = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => stack.user(n)));
    await group(stack, a!, [b!, c!]);
    await direct(stack, a!, d!);
    expect((await stack.call(c!, 'POST', '/blocks', { user_id: a!.id })).status).toBe(204);
    const [aLive, bLive, cLive, dLive, eLive] = await Promise.all(
      [a!, b!, c!, d!, e!].map((u) => stack.connect(u)),
    );

    const res = await stack.call(a!, 'PATCH', '/users/me', { display_name: 'Alice Renamed' });
    expect(res.status).toBe(200);

    await waitUntil(() => bLive!.of('user_updated').length >= 1, 8_000, 'b hears the rename');
    await waitUntil(() => dLive!.of('user_updated').length >= 1, 8_000, 'd hears the rename');
    await waitUntil(() => aLive!.of('user_updated').length >= 1, 8_000, 'own devices hear it');
    await waitForOutboxDrained(stack.db);
    expect(bLive!.of('user_updated')).toEqual([
      expect.objectContaining({ user_id: a!.id, display_name: 'Alice Renamed' }),
    ]);
    expect(cLive!.of('user_updated')).toHaveLength(0); // c blocked a
    expect(eLive!.of('user_updated')).toHaveLength(0); // shares no chat
  });

  it('is not sent to someone the user blocked, and not when nothing changed', async () => {
    const [a, b] = await Promise.all([stack.user('f'), stack.user('g')]);
    await group(stack, a, [b]);
    expect((await stack.call(a, 'POST', '/blocks', { user_id: b.id })).status).toBe(204);
    const bLive = await stack.connect(b);
    await stack.call(a, 'PATCH', '/users/me', { display_name: 'Blocked Rename' });
    await waitForOutboxDrained(stack.db);
    expect(bLive.of('user_updated')).toHaveLength(0);

    const after = await profileEventCount(a.id);
    expect(after).toBeGreaterThan(0);
    await stack.call(a, 'PATCH', '/users/me', { display_name: 'Blocked Rename' }); // same value
    await stack.call(a, 'PATCH', '/users/me', { about: 'only the about line' });
    expect(await profileEventCount(a.id)).toBe(after); // nothing changed, nothing announced
  });

  it('writes one event per conversation, at most the cap', async () => {
    const a = await stack.user('h');
    const extra = PROFILE_ANNOUNCE_MAX_CONVERSATIONS + 5;
    await sql`
      WITH made AS (
        INSERT INTO conversations (type, name, last_message_at)
        SELECT 'group', 'cap ' || n, now() - (n || ' seconds')::interval
        FROM generate_series(1, ${extra}::int) AS n
        RETURNING id
      )
      INSERT INTO conversation_members (conversation_id, user_id, role)
      SELECT id, ${a.id}::uuid, 'member' FROM made`.execute(stack.db);
    await stack.call(a, 'PATCH', '/users/me', { display_name: 'Cap Tester' });
    await waitForOutboxDrained(stack.db);
    const { rows } = await sql<{ n: string; d: string }>`
      SELECT count(*) AS n, count(DISTINCT payload->>'conversation_id') AS d FROM outbox
      WHERE payload->>'type' = 'conversation.member_profile_changed'
        AND payload->'data'->>'user_id' = ${a.id}`.execute(stack.db);
    expect(Number(rows[0]!.n)).toBe(PROFILE_ANNOUNCE_MAX_CONVERSATIONS);
    expect(Number(rows[0]!.d)).toBe(PROFILE_ANNOUNCE_MAX_CONVERSATIONS);
  });
});
