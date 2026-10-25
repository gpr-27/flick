import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PushSender } from '../../src/modules/push/sender.js';
import { startTestApp } from './support.js';

// Subscription coverage: what the server knows about a device, and the test notification button.
const fail = (statusCode: number) => Object.assign(new Error('push service'), { statusCode });
const sent: { endpoint: string; payload: string }[] = [];
const sender = vi.fn<PushSender>((target, payload) => {
  if (target.endpoint.includes('gone')) return Promise.reject(fail(410));
  if (target.endpoint.includes('broken')) return Promise.reject(fail(503));
  sent.push({ endpoint: target.endpoint, payload });
  return Promise.resolve({ statusCode: 201 });
});

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp({ pushSender: sender, vapidPublicKey: 'public-key-for-tests' });
});
afterAll(async () => {
  await t.stop();
});

const keys = { p256dh: 'p', auth: 'a' };
const hash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

describe('push status', () => {
  it('says whether this device is subscribed, by a fingerprint of its endpoint, and counts the others', async () => {
    const user = await t.makeUser();
    const phone = await t.makeDevice(user);
    const laptop = await t.makeDevice(user);
    const endpoint = 'https://push.example/phone';

    const before = await t.call(user, 'GET', '/push/status', undefined, phone);
    expect(before.body).toEqual({
      server_ready: true,
      this_device: { subscribed: false, endpoint_hash: null, last_status: null },
      other_devices: 0,
    });

    await t.call(user, 'POST', '/push/subscribe', { endpoint, keys }, phone);
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/laptop', keys },
      laptop,
    );

    const res = await t.call(user, 'GET', '/push/status', undefined, phone);
    expect(res.body).toEqual({
      server_ready: true,
      this_device: { subscribed: true, endpoint_hash: hash(endpoint), last_status: null },
      other_devices: 1,
    });
    // No endpoint or key anywhere in the answer.
    expect(JSON.stringify(res.body)).not.toContain('push.example');
  });

  it('keeps one row per device: a renewed endpoint replaces the old one', async () => {
    const user = await t.makeUser();
    const device = await t.makeDevice(user);
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/old', keys },
      device,
    );
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/new', keys },
      device,
    );
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/new', keys },
      device,
    );

    const rows = await t.db
      .selectFrom('push_subscriptions')
      .select(['endpoint', 'device_id'])
      .where('user_id', '=', user)
      .execute();
    expect(rows).toEqual([{ endpoint: 'https://push.example/new', device_id: device }]);
  });

  it('stores the device choices, and keeps them when a later subscribe says nothing', async () => {
    const user = await t.makeUser();
    const device = await t.makeDevice(user);
    const endpoint = 'https://push.example/prefs';
    const prefs = { previews: false, quiet: { from_min: 1320, to_min: 420, offset_min: 330 } };
    await t.call(user, 'POST', '/push/subscribe', { endpoint, keys, prefs }, device);
    await t.call(user, 'POST', '/push/subscribe', { endpoint, keys }, device);

    const row = await t.db
      .selectFrom('push_subscriptions')
      .select('prefs')
      .where('endpoint', '=', endpoint)
      .executeTakeFirstOrThrow();
    expect(row.prefs).toEqual(prefs);
    const bad = await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint, keys, prefs: { quiet: { from_min: 5000, to_min: 0, offset_min: 0 } } },
      device,
    );
    expect(bad.status).toBe(400);
  });

  it('does not count a signed-out (revoked) device', async () => {
    const user = await t.makeUser();
    const phone = await t.makeDevice(user);
    const old = await t.makeDevice(user);
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/p', keys },
      phone,
    );
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/o', keys },
      old,
    );
    await t.db
      .updateTable('devices')
      .set({ revoked_at: new Date() })
      .where('id', '=', old)
      .execute();

    const res = await t.call(user, 'GET', '/push/status', undefined, phone);
    expect(res.body.other_devices).toBe(0);
  });
});

describe('send me a test notification', () => {
  it('pushes to the caller own devices only and reports each push service answer', async () => {
    sent.length = 0;
    const user = await t.makeUser();
    const other = await t.makeUser();
    const phone = await t.makeDevice(user);
    const laptop = await t.makeDevice(user);
    const strangers = await t.makeDevice(other);
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://fcm.example/phone', keys },
      phone,
    );
    await t.call(
      user,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/laptop-gone', keys },
      laptop,
    );
    await t.call(
      other,
      'POST',
      '/push/subscribe',
      { endpoint: 'https://push.example/stranger', keys },
      strangers,
    );

    const res = await t.call(user, 'POST', '/push/test', undefined, phone);

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('sent');
    expect(res.body.devices).toEqual([
      { result: 'sent', status: 201, service: 'fcm.example', this_device: true },
      { result: 'expired', status: 410, service: 'push.example', this_device: false },
    ]);
    expect(sent.map((s) => s.endpoint)).toEqual(['https://fcm.example/phone']); // never the stranger
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({
      type: 'test',
      title: 'Flick test notification',
    });
    // The dead one is switched off and the answer is remembered.
    const rows = await t.db
      .selectFrom('push_subscriptions')
      .select(['endpoint', 'disabled_at', 'last_status'])
      .where('user_id', '=', user)
      .orderBy('endpoint')
      .execute();
    expect(rows.map((r) => [r.last_status, r.disabled_at !== null])).toEqual([
      [201, false],
      [410, true],
    ]);
  });

  it('reports a failing push service as failed and keeps the subscription', async () => {
    const user = await t.makeUser();
    await t.call(user, 'POST', '/push/subscribe', {
      endpoint: 'https://push.example/broken',
      keys,
    });
    const res = await t.call(user, 'POST', '/push/test');
    expect(res.body.devices).toMatchObject([{ result: 'failed', status: 503 }]);
    expect(
      await t.db
        .selectFrom('push_subscriptions')
        .select('disabled_at')
        .where('user_id', '=', user)
        .execute(),
    ).toEqual([{ disabled_at: null }]);
  });

  it('says when there is nothing to send to', async () => {
    const user = await t.makeUser();
    expect((await t.call(user, 'POST', '/push/test')).body).toEqual({
      devices: [],
      reason: 'no_subscription',
    });
  });

  it('allows 3 a minute per person', async () => {
    const user = await t.makeUser();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await t.call(user, 'POST', '/push/test')).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    // Another person is not affected.
    expect((await t.call(await t.makeUser(), 'POST', '/push/test')).status).toBe(200);
  });
});
