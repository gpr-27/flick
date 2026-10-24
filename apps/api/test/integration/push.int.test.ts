import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

describe('push subscriptions', () => {
  const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };

  it('stores a subscription once, re-enables it on re-subscribe and removes it on unsubscribe', async () => {
    const user = await t.makeUser();
    expect((await t.call(user, 'POST', '/push/subscribe', subscription)).status).toBe(204);
    await t.db
      .updateTable('push_subscriptions')
      .set({ disabled_at: new Date() })
      .where('endpoint', '=', subscription.endpoint)
      .execute();

    expect((await t.call(user, 'POST', '/push/subscribe', subscription)).status).toBe(204);
    const rows = await t.db
      .selectFrom('push_subscriptions')
      .select(['user_id', 'disabled_at'])
      .where('endpoint', '=', subscription.endpoint)
      .execute();
    expect(rows).toEqual([{ user_id: user, disabled_at: null }]);

    const other = await t.makeUser(); // someone else cannot remove it
    await t.call(other, 'POST', '/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await t.db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(1);
    await t.call(user, 'POST', '/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await t.db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(0);
  });

  it('moves an endpoint to the next person who signs in on the same browser', async () => {
    const first = await t.makeUser();
    const second = await t.makeUser();
    await t.call(first, 'POST', '/push/subscribe', subscription);
    await t.call(second, 'POST', '/push/subscribe', subscription);
    const rows = await t.db
      .selectFrom('push_subscriptions')
      .select('user_id')
      .where('endpoint', '=', subscription.endpoint)
      .execute();
    expect(rows).toEqual([{ user_id: second }]);

    // The first user can no longer remove it; the new owner can.
    await t.call(first, 'POST', '/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await t.db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(1);
    await t.call(second, 'POST', '/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await t.db.selectFrom('push_subscriptions').select('id').execute()).toHaveLength(0);
  });

  it('rejects a non-https endpoint and reports no VAPID key when none is configured', async () => {
    const user = await t.makeUser();
    const bad = await t.call(user, 'POST', '/push/subscribe', {
      ...subscription,
      endpoint: 'http://insecure.example/x',
    });
    expect(bad.status).toBe(400);
    expect(await t.call(user, 'GET', '/push/vapid-key')).toMatchObject({
      status: 200,
      body: { public_key: null },
    });
  });
});
