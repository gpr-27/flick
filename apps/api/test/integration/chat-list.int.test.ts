/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- test responses are untyped JSON */
import { allocateSeqAndInsertMessage } from '@chat/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

// "Delete chat" (for me only), "Clear chat" and "Mark as unread" from the chat list.
let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

const say = (conversationId: string, senderId: string, text: string) =>
  allocateSeqAndInsertMessage(t.db, {
    conversationId,
    senderId,
    senderDeviceId: null,
    clientMessageId: null,
    type: 'text',
    bodyText: text,
    authorize: false,
  });

async function chat() {
  const [a, b] = [await t.makeUser(), await t.makeUser()];
  const id = (await t.call(a, 'POST', '/conversations/direct', { user_id: b })).body.id as string;
  return { a, b, id };
}
const ids = async (user: string) =>
  ((await t.call(user, 'GET', '/conversations')).body.items as { id: string }[]).map((c) => c.id);
const history = async (user: string, id: string) =>
  (
    (await t.call(user, 'GET', `/conversations/${id}/messages`)).body.items as {
      content: { text?: string };
    }[]
  ).map((m) => m.content.text);
const sync = (user: string, id: string) =>
  t.call(user, 'POST', '/sync', { cursors: [{ conversation_id: id, after_seq: 0 }], limit: 50 });

describe('DELETE /conversations/:id (delete for me)', () => {
  it('removes my copy everywhere and leaves the other person untouched', async () => {
    const { a, b, id } = await chat();
    await say(id, a, 'secret plan');
    await say(id, b, 'ok');

    expect((await t.call(a, 'DELETE', `/conversations/${id}`)).status).toBe(204);

    expect(await ids(a)).not.toContain(id);
    expect(await ids(b)).toContain(id);
    expect(await history(a, id)).toEqual([]);
    expect(await history(b, id)).toEqual(['ok', 'secret plan']);
    expect((await t.call(a, 'GET', '/search?q=secret')).body.items).toEqual([]);
    expect((await t.call(b, 'GET', '/search?q=secret')).body.items).toHaveLength(1);

    // sync: no events for me after the cut, and the chat is reported as removed
    const mine = await sync(a, id);
    expect(mine.body.events).toEqual([]);
    expect(mine.body.removed_conversation_ids).toEqual([id]);
    expect((await sync(b, id)).body.events).toHaveLength(2);
  });

  it('starting a deleted direct chat again brings it back, empty, instead of "not found"', async () => {
    const { a, b, id } = await chat();
    await say(id, b, 'old news');
    await t.call(a, 'DELETE', `/conversations/${id}`);
    expect(await ids(a)).not.toContain(id);

    const reopened = await t.call(a, 'POST', '/conversations/direct', { user_id: b });
    expect(reopened.status).toBe(200);
    expect(reopened.body.id).toBe(id);
    expect(await ids(a)).toContain(id);
    expect(await history(a, id)).toEqual([]);
  });

  it('brings the chat back with only the newer messages', async () => {
    const { a, b, id } = await chat();
    await say(id, b, 'old news');
    await t.call(a, 'DELETE', `/conversations/${id}`);
    expect(await ids(a)).not.toContain(id);

    await say(id, b, 'fresh');
    expect(await ids(a)).toContain(id);
    expect(await history(a, id)).toEqual(['fresh']);
    const summary = (await t.call(a, 'GET', `/conversations/${id}`)).body;
    expect(summary.last_message.content.text).toBe('fresh');
    expect(summary.unread_count).toBe(1);

    const replay = await sync(a, id);
    expect(
      (replay.body.events as { payload: { message: { content: { text: string } } } }[]).map(
        (e) => e.payload.message.content.text,
      ),
    ).toEqual(['fresh']);
    expect(replay.body.removed_conversation_ids).toEqual([]);
  });

  it('keeps deleted messages out of the data export', async () => {
    const { a, b, id } = await chat();
    await say(id, b, 'gone soon');
    await t.call(a, 'DELETE', `/conversations/${id}`);
    await say(id, b, 'kept');
    const res = await t.app.inject({
      method: 'GET',
      url: '/users/me/export',
      headers: { 'x-user-id': a },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('kept');
    expect(res.body).not.toContain('gone soon');
  });

  it('is 404 for someone outside the chat and for an unknown chat', async () => {
    const { id } = await chat();
    const stranger = await t.makeUser();
    expect((await t.call(stranger, 'DELETE', `/conversations/${id}`)).status).toBe(404);
    expect((await t.call(stranger, 'DELETE', `/conversations/${randomUUID()}`)).status).toBe(404);
  });

  it('asks for a group to be left first', async () => {
    const [owner, m] = [await t.makeUser(), await t.makeUser()];
    const g = await t.call(owner, 'POST', '/conversations/group', { title: 'G', member_ids: [m] });
    const res = await t.call(m, 'DELETE', `/conversations/${g.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await ids(m)).toContain(g.body.id);
  });

  it('only clears Saved messages: the chat stays, empty', async () => {
    const me = await t.makeUser();
    const saved = (await t.call(me, 'POST', '/conversations/saved')).body.id as string;
    await say(saved, me, 'note to self');
    expect((await t.call(me, 'DELETE', `/conversations/${saved}`)).status).toBe(204);
    expect(await ids(me)).toContain(saved);
    expect(await history(me, saved)).toEqual([]);
    const summary = (await t.call(me, 'GET', `/conversations/${saved}`)).body;
    expect(summary.last_message).toBeNull();
    expect(summary.unread_count).toBe(0);
  });
});

describe('mark as unread', () => {
  it('is a per-member flag in the prefs', async () => {
    const { a, b, id } = await chat();
    const on = await t.call(a, 'PATCH', `/conversations/${id}/prefs`, { marked_unread: true });
    expect(on.body.marked_unread).toBe(true);
    expect((await t.call(a, 'GET', `/conversations/${id}`)).body.prefs.marked_unread).toBe(true);
    expect((await t.call(b, 'GET', `/conversations/${id}`)).body.prefs.marked_unread).toBe(false);
    const off = await t.call(a, 'PATCH', `/conversations/${id}/prefs`, { marked_unread: false });
    expect(off.body.marked_unread).toBe(false);
  });
});
