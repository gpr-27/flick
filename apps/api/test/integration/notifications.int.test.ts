import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createGateDb,
  eventually,
  type GateApp,
  type GateDb,
  type GateUser,
} from './gate-helpers.js';

// The notification centre end to end on the real app: the dispatcher writes alerts and tells the
// person live; the REST endpoints list, read and clear them (only the caller's own).
let env: GateDb;
let api: GateApp;
beforeAll(async () => {
  env = await createGateDb();
  api = await env.startApp();
});
afterAll(async () => {
  await env.destroy();
});

const alertsOf = (user: GateUser) =>
  env.db.selectFrom('notifications').selectAll().where('user_id', '=', user.id).execute();

const mute = (conv: string, user: GateUser) =>
  env.db
    .updateTable('conversation_members')
    .set({ muted_until: sql<Date>`now() + interval '1 day'` })
    .where('conversation_id', '=', conv)
    .where('user_id', '=', user.id)
    .execute();

describe('who is alerted', () => {
  it('writes a centre row for an away member, a live one for a mention, none for a muted chat', async () => {
    const [alice, bob, carol, dave, erin] = await Promise.all(
      Array.from({ length: 5 }, () => env.makeUser()),
    );
    const conv = await env.makeGroup([alice!, bob!, carol!, dave!, erin!]);
    await mute(conv, erin!);
    const a = await api.connect(alice!);
    const c = await api.connect(carol!); // connected: saw it live
    const d = await api.connect(dave!);

    const sent = await a.request('send_message', {
      conversation_id: conv,
      client_message_id: `cm_${randomUUID()}`,
      content: { type: 'text', text: 'hey @dave', mentions: [dave!.id] },
    });
    await eventually(() => env.outboxDone(conv), 'the dispatcher');
    await d.flush();
    await c.flush();

    // Bob is away: a row (and a push job). Carol is connected and was not named: no row yet.
    expect((await alertsOf(bob!)).map((n) => n.kind)).toEqual(['message']);
    expect(await alertsOf(carol!)).toHaveLength(0);
    // Dave was named: a row even though he is connected, and the bell hears about it live.
    expect((await alertsOf(dave!)).map((n) => n.kind)).toEqual(['mention']);
    expect(d.of('notification_created')).toMatchObject([
      { kind: 'mention', conversation_id: conv, message_id: sent.data.message_id },
    ]);
    expect(c.of('notification_created')).toHaveLength(0);
    // Erin muted the chat; the sender is never alerted.
    expect(await alertsOf(erin!)).toHaveLength(0);
    expect(await alertsOf(alice!)).toHaveLength(0);
  });

  it('a mention or a reply gets through a muted chat', async () => {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    await mute(conv, bob);
    const a = await api.connect(alice);
    const b = await api.connect(bob);

    const mine = await b.send(conv, 'my own message');
    const send = (content: object) =>
      a.request('send_message', {
        conversation_id: conv,
        client_message_id: `cm_${randomUUID()}`,
        content,
      });
    await send({ type: 'text', text: 'plain' });
    await send({ type: 'text', text: 'named', mentions: [bob.id] });
    await send({ type: 'text', text: 'answer', reply_to: mine.data.message_id });
    await eventually(() => env.outboxDone(conv), 'the dispatcher');

    expect((await alertsOf(bob)).map((n) => n.kind).sort()).toEqual(['mention', 'reply']);
    const kinds = (await env.notifyJobs(conv))
      .filter((j) => j.user_id === bob.id)
      .map((j) => (j as { kind?: string }).kind);
    expect(kinds.sort()).toEqual(['mention', 'reply']);
  });
});

describe('the notification endpoints', () => {
  /** Alice writes `count` messages in a chat with Bob while Bob is away. */
  async function away(count: number) {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    const a = await api.connect(alice);
    const messages: { message_id: string; seq: number }[] = [];
    for (let i = 1; i <= count; i++) messages.push((await a.send(conv, `message ${i}`)).data);
    await eventually(async () => (await alertsOf(bob)).length === count, 'the alerts');
    return { alice, bob, conv, messages };
  }

  it('lists newest first with a live preview, and counts what is unread', async () => {
    const { bob, conv, messages } = await away(3);

    const res = await api.rest(bob, 'GET', '/notifications');

    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(3);
    expect(res.body.next_cursor).toBeNull();
    expect(res.body.items.map((i: { message_id: string }) => i.message_id)).toEqual(
      [...messages].reverse().map((m) => m.message_id),
    );
    expect(res.body.items[0]).toMatchObject({
      kind: 'message',
      read: false,
      available: true,
      conversation_id: conv,
      seq: 3,
      preview: 'message 3',
      chat_name: 'gate group',
      is_group: true,
      sender_name: 'User',
    });
    expect((await api.rest(bob, 'GET', '/notifications/unread')).body).toEqual({ unread_count: 3 });
  });

  it('pages with a keyset cursor and never repeats or skips an alert', async () => {
    const { bob, messages } = await away(5);

    const first = (await api.rest(bob, 'GET', '/notifications?limit=2')).body;
    const second = (
      await api.rest(bob, 'GET', `/notifications?limit=2&cursor=${first.next_cursor}`)
    ).body;
    const third = (
      await api.rest(bob, 'GET', `/notifications?limit=2&cursor=${second.next_cursor}`)
    ).body;

    const ids = [...first.items, ...second.items, ...third.items].map(
      (i: { message_id: string }) => i.message_id,
    );
    expect(ids).toEqual([...messages].reverse().map((m) => m.message_id));
    expect(third.next_cursor).toBeNull();
    expect((await api.rest(bob, 'GET', '/notifications?cursor=%25%25')).status).toBe(400);
  });

  it('marks some alerts read, then all of them', async () => {
    const { bob } = await away(3);
    const list = (await api.rest(bob, 'GET', '/notifications')).body;

    const one = await api.rest(bob, 'POST', '/notifications/read', { ids: [list.items[0].id] });
    expect(one.body).toEqual({ unread_count: 2 });
    const all = await api.rest(bob, 'POST', '/notifications/read', { all: true });
    expect(all.body).toEqual({ unread_count: 0 });
    const after = (await api.rest(bob, 'GET', '/notifications')).body;
    expect(after.items.every((i: { read: boolean }) => i.read)).toBe(true);
    expect((await api.rest(bob, 'POST', '/notifications/read', {})).status).toBe(400);
  });

  it('counts an alert as read once the chat itself is read', async () => {
    const { bob, conv } = await away(3);
    await env.db
      .updateTable('conversation_members')
      .set({ read_seq: 2 })
      .where('conversation_id', '=', conv)
      .where('user_id', '=', bob.id)
      .execute();

    const res = (await api.rest(bob, 'GET', '/notifications')).body;

    expect(res.unread_count).toBe(1);
    expect(res.items.map((i: { read: boolean }) => i.read)).toEqual([false, true, true]);
  });

  it('shows a deleted message as unavailable, with no text', async () => {
    const { bob, messages } = await away(2);
    await env.db
      .updateTable('messages')
      .set({ deleted_at: new Date(), body_text: null })
      .where('id', '=', messages[1]!.message_id)
      .execute();

    const [latest, older] = (await api.rest(bob, 'GET', '/notifications')).body.items;

    expect(latest).toMatchObject({ available: false, preview: null, sender_name: null });
    expect(older).toMatchObject({ available: true, preview: 'message 1' });
  });

  it('only ever shows, changes and clears the caller own alerts', async () => {
    const { alice, bob } = await away(2);
    const bobs = (await api.rest(bob, 'GET', '/notifications')).body.items;

    // Alice has none of her own and cannot read Bob's.
    expect((await api.rest(alice, 'GET', '/notifications')).body.items).toEqual([]);
    await api.rest(alice, 'POST', '/notifications/read', {
      ids: bobs.map((i: { id: string }) => i.id),
    });
    await api.rest(alice, 'POST', '/notifications/read', { all: true });
    await api.rest(alice, 'DELETE', '/notifications');
    expect((await api.rest(bob, 'GET', '/notifications')).body.unread_count).toBe(2);

    const cleared = await api.rest(bob, 'DELETE', '/notifications');
    expect(cleared.status).toBe(204);
    expect((await api.rest(bob, 'GET', '/notifications')).body).toEqual({
      items: [],
      next_cursor: null,
      unread_count: 0,
    });
  });

  it('does not list alerts older than 30 days', async () => {
    const { bob } = await away(1);
    await env.db
      .updateTable('notifications')
      .set({ created_at: sql<Date>`now() - interval '31 days'` })
      .where('user_id', '=', bob.id)
      .execute();

    expect((await api.rest(bob, 'GET', '/notifications')).body.items).toEqual([]);
  });

  it('needs a signed-in caller', async () => {
    const res = await fetch(`${api.url}/notifications`);
    expect(res.status).toBe(401);
  });
});
