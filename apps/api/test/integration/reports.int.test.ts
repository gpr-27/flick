import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

describe('POST /reports', () => {
  it('stores a user report and blocks when asked', async () => {
    const alice = await t.makeUser();
    const bob = await t.makeUser();
    const res = await t.call(alice, 'POST', '/reports', {
      user_id: bob,
      reason: 'spam',
      block: true,
    });
    expect(res.status).toBe(200);
    const report = await t.db
      .selectFrom('reports')
      .select(['reporter_id', 'reported_user_id', 'status'])
      .where('id', '=', (res.body as { report_id: string }).report_id)
      .executeTakeFirstOrThrow();
    expect(report).toEqual({ reporter_id: alice, reported_user_id: bob, status: 'open' });
    const block = await t.db
      .selectFrom('blocks')
      .select('blocked_id')
      .where('blocker_id', '=', alice)
      .execute();
    expect(block).toEqual([{ blocked_id: bob }]);
  });

  it('rejects a report that names nobody and a message the reporter cannot see', async () => {
    const alice = await t.makeUser();
    expect((await t.call(alice, 'POST', '/reports', { reason: 'spam' })).status).toBe(400);
    const missing = '00000000-0000-4000-8000-000000000001';
    const res = await t.call(alice, 'POST', '/reports', {
      conversation_id: missing,
      message_id: missing,
      reason: 'spam',
    });
    expect(res.status).toBe(404);
  });
});
