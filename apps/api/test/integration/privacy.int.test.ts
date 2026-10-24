import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGatewayRepo } from '../../src/modules/gateway/repo.js';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

const LAST_SEEN = new Date('2026-01-01T10:00:00.000Z');

async function makeUserWithProfile() {
  const id = await t.makeUser();
  await t.db
    .updateTable('users')
    .set({ about: 'hello there', last_seen_at: LAST_SEEN, avatar_url: 'https://img.example/a.png' })
    .where('id', '=', id)
    .execute();
  return id;
}

describe('privacy settings', () => {
  it('start with the defaults, save changes and keep the rest', async () => {
    const user = await t.makeUser();
    expect(await t.call(user, 'GET', '/users/me/privacy')).toMatchObject({
      status: 200,
      body: {
        last_seen: 'everyone',
        profile_photo: 'everyone',
        about: 'everyone',
        read_receipts: true,
      },
    });

    const patched = await t.call(user, 'PATCH', '/users/me/privacy', {
      last_seen: 'nobody',
      read_receipts: false,
    });
    expect(patched.body).toEqual({
      last_seen: 'nobody',
      profile_photo: 'everyone',
      about: 'everyone',
      read_receipts: false,
    });
    expect((await t.call(user, 'GET', '/users/me/privacy')).body).toEqual(patched.body);
  });

  it('rejects an audience that does not exist (there is no contact list)', async () => {
    const user = await t.makeUser();
    const res = await t.call(user, 'PATCH', '/users/me/privacy', { last_seen: 'contacts' });
    expect(res.status).toBe(400);
  });
});

describe('profile', () => {
  it('shows another user what their privacy settings allow', async () => {
    const alice = await t.makeUser();
    const bob = await makeUserWithProfile();

    const open = await t.call(alice, 'GET', `/users/${bob}`);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({
      id: bob,
      about: 'hello there',
      avatar_url: 'https://img.example/a.png',
      last_seen_at: LAST_SEEN.toISOString(),
      online: false,
      blocked_by_me: false,
    });

    await t.call(bob, 'PATCH', '/users/me/privacy', {
      last_seen: 'nobody',
      profile_photo: 'nobody',
      about: 'nobody',
    });
    const hidden = await t.call(alice, 'GET', `/users/${bob}`);
    expect(hidden.body).toMatchObject({ about: null, avatar_url: null, last_seen_at: null });

    // Bob still sees everything of his own.
    const own = await t.call(bob, 'GET', `/users/${bob}`);
    expect(own.body).toMatchObject({ about: 'hello there', last_seen_at: LAST_SEEN.toISOString() });
  });

  it('a private last seen is hidden from the real-time presence too', async () => {
    const bob = await makeUserWithProfile();
    const repo = createGatewayRepo(t.db);
    expect((await repo.visibleLastSeen([bob])).get(bob)).toBe(LAST_SEEN.toISOString());
    await t.call(bob, 'PATCH', '/users/me/privacy', { last_seen: 'nobody' });
    expect((await repo.visibleLastSeen([bob])).get(bob)).toBeNull();
  });

  it('is 404 for an unknown user or one who blocked the caller, and shows blocked_by_me', async () => {
    const alice = await t.makeUser();
    const bob = await t.makeUser();
    expect((await t.call(alice, 'GET', `/users/${crypto.randomUUID()}`)).status).toBe(404);

    await t.call(alice, 'POST', '/blocks', { user_id: bob });
    expect((await t.call(alice, 'GET', `/users/${bob}`)).body).toMatchObject({
      blocked_by_me: true,
    });
    expect((await t.call(bob, 'GET', `/users/${alice}`)).status).toBe(404);
  });
});
