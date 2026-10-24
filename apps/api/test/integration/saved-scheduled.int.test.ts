/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- test responses are untyped JSON */
import { LIMITS } from '@chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('saved messages', () => {
  it('is created on first use, is the same chat every time, and is private', async () => {
    const me = await t.makeUser();
    const other = await t.makeUser();

    const first = await t.call(me, 'POST', '/conversations/saved');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ is_saved: true, peer: null, member_count: 1 });

    const again = await t.call(me, 'POST', '/conversations/saved');
    expect(again.body.id).toBe(first.body.id);

    const list = await t.call(me, 'GET', '/conversations');
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([first.body.id]);
    expect(await t.call(other, 'GET', `/conversations/${first.body.id}`)).toMatchObject({
      status: 404,
    });
  });

  it('two requests at once still make one chat', async () => {
    const me = await t.makeUser();
    const [a, b] = await Promise.all([
      t.call(me, 'POST', '/conversations/saved'),
      t.call(me, 'POST', '/conversations/saved'),
    ]);
    expect(a.body.id).toBe(b.body.id);
  });

  it('is not marked on a normal direct chat', async () => {
    const me = await t.makeUser();
    const friend = await t.makeUser();
    const direct = await t.call(me, 'POST', '/conversations/direct', { user_id: friend });
    expect(direct.body.is_saved).toBe(false);
  });
});

describe('scheduled messages', () => {
  async function chatOf(userId: string) {
    return (await t.call(userId, 'POST', '/conversations/saved')).body.id as string;
  }

  it('creates, lists and cancels', async () => {
    const me = await t.makeUser();
    const conv = await chatOf(me);

    const created = await t.call(me, 'POST', `/conversations/${conv}/scheduled`, {
      text: '  call mum  ',
      send_at: inMinutes(10),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      conversation_id: conv,
      text: 'call mum',
      status: 'pending',
      failed_reason: null,
    });

    const list = await t.call(me, 'GET', '/scheduled');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(created.body.id);

    expect((await t.call(me, 'DELETE', `/scheduled/${created.body.id}`)).status).toBe(204);
    expect((await t.call(me, 'GET', '/scheduled')).body.items).toEqual([]);
    expect((await t.call(me, 'DELETE', `/scheduled/${created.body.id}`)).status).toBe(404);
  });

  it('rejects times that are too soon or too far, and empty text', async () => {
    const me = await t.makeUser();
    const conv = await chatOf(me);
    const path = `/conversations/${conv}/scheduled`;
    const tooFar = LIMITS.SCHEDULE_MAX_LEAD_S / 60 + 5;
    expect((await t.call(me, 'POST', path, { text: 'x', send_at: inMinutes(0) })).status).toBe(400);
    expect((await t.call(me, 'POST', path, { text: 'x', send_at: inMinutes(tooFar) })).status).toBe(
      400,
    );
    expect((await t.call(me, 'POST', path, { text: '   ', send_at: inMinutes(5) })).status).toBe(
      400,
    );
  });

  it('only for chats you are in, and only your own can be cancelled', async () => {
    const me = await t.makeUser();
    const stranger = await t.makeUser();
    const conv = await chatOf(me);
    const body = { text: 'hi', send_at: inMinutes(5) };

    expect((await t.call(stranger, 'POST', `/conversations/${conv}/scheduled`, body)).status).toBe(
      404,
    );

    const mine = await t.call(me, 'POST', `/conversations/${conv}/scheduled`, body);
    expect((await t.call(stranger, 'DELETE', `/scheduled/${mine.body.id}`)).status).toBe(404);
    expect((await t.call(stranger, 'GET', '/scheduled')).body.items).toEqual([]);
  });

  it('stops at the per-user limit', async () => {
    const me = await t.makeUser();
    const conv = await chatOf(me);
    const rows = Array.from({ length: LIMITS.MAX_SCHEDULED_PER_USER }, () => ({
      user_id: me,
      conversation_id: conv,
      body_text: 'later',
      send_at: new Date(Date.now() + 3_600_000),
    }));
    await t.db.insertInto('scheduled_messages').values(rows).execute();
    const res = await t.call(me, 'POST', `/conversations/${conv}/scheduled`, {
      text: 'one more',
      send_at: inMinutes(5),
    });
    expect(res.status).toBe(409);
  });
});

describe('about line', () => {
  it('saves, trims, clears, and refuses a line over the limit', async () => {
    const me = await t.makeUser();
    const saved = await t.call(me, 'PATCH', '/users/me', { about: '  Hey there, I am on Flick  ' });
    expect(saved.body.about).toBe('Hey there, I am on Flick');

    const tooLong = await t.call(me, 'PATCH', '/users/me', {
      about: 'x'.repeat(LIMITS.MAX_ABOUT_LENGTH + 1),
    });
    expect(tooLong.status).toBe(400);

    expect((await t.call(me, 'PATCH', '/users/me', { about: '' })).body.about).toBeNull();
    expect((await t.call(me, 'PATCH', '/users/me', { about: null })).body.about).toBeNull();
  });
});
