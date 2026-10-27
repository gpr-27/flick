/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { LIMITS, MessageRecord } from '@chat/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attachment,
  createDatabase,
  direct,
  send,
  startStack,
  type Stack,
  type TestDatabase,
} from './harness.js';

// An album is N ordinary messages linked by `album: { id, index, count }`. The server stores the
// field as sent, hands it back through every read path, and refuses inconsistent metadata.

let database: TestDatabase;
let stack: Stack;

beforeAll(async () => {
  database = await createDatabase('album');
  stack = await startStack({ databaseUrl: database.url });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

const meta = (id: string, index: number, count: number, videos?: number) => ({
  id,
  index,
  count,
  ...(videos ? { videos } : {}),
});

describe('albums', () => {
  it('stores a 3-item album and reads it back through history, sync and the chat list', async () => {
    const alice = await stack.user('alice');
    const bob = await stack.user('bob');
    const conv = await direct(stack, alice, bob);
    const albumId = randomUUID();
    const sent = [];
    for (const [index, kind] of (['image', 'video', 'image'] as const).entries()) {
      const att = await attachment(stack.db, alice, kind);
      const content =
        kind === 'image'
          ? { type: 'image', attachment_id: att, width: 800, height: 600 }
          : { type: 'video', attachment_id: att, width: 1280, height: 720, duration_ms: 4000 };
      const res = await send(stack, alice, conv, {
        ...content,
        album: meta(albumId, index, 3, 1),
        ...(index === 0 ? { caption: 'Beach day' } : {}),
      });
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      sent.push(res.body);
    }

    // History (the reader's view), oldest first
    const history = await stack.call(bob, 'GET', `/conversations/${conv}/messages`);
    // History is newest first; the grid is drawn by album index.
    const items = (history.body.items as any[])
      .filter((m) => m.content?.album)
      .sort((a, b) => a.content.album.index - b.content.album.index);
    expect(items.map((m) => m.content.album)).toEqual([
      meta(albumId, 0, 3, 1),
      meta(albumId, 1, 3, 1),
      meta(albumId, 2, 3, 1),
    ]);
    expect(items.map((m) => m.content.type)).toEqual(['image', 'video', 'image']);
    expect(items[0].content.caption).toBe('Beach day');
    expect(new Set(items.map((m) => m.message_id)).size).toBe(3); // three real messages
    for (const m of items) expect(MessageRecord.safeParse(m).success).toBe(true);

    // Sync
    const sync = await stack.call(bob, 'POST', '/sync', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 50,
    });
    const synced = (sync.body.events as any[])
      .filter((e) => e.type === 'new_message' && e.payload.message.content?.album)
      .map((e) => e.payload.message.content.album);
    expect(synced).toEqual([
      meta(albumId, 0, 3, 1),
      meta(albumId, 1, 3, 1),
      meta(albumId, 2, 3, 1),
    ]);

    // Chat list: the newest message is the last item, which carries the whole album's counts.
    const list = await stack.call(bob, 'GET', '/conversations');
    const row = (list.body.items as any[]).find((c) => c.id === conv);
    expect(MessageRecord.safeParse(row.last_message).success).toBe(true);
    expect(row.last_message.content.album).toEqual(meta(albumId, 2, 3, 1));
    expect(row.last_message.content.type).toBe('image');
  });

  it('each item has its own life: deleting one leaves the others', async () => {
    const alice = await stack.user('alice2');
    const bob = await stack.user('bob2');
    const conv = await direct(stack, alice, bob);
    const albumId = randomUUID();
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const att = await attachment(stack.db, alice, 'image');
      const res = await send(stack, alice, conv, {
        type: 'image',
        attachment_id: att,
        width: 10,
        height: 10,
        album: meta(albumId, index, 2),
      });
      ids.push(res.body.message_id ?? res.body.id);
    }
    const del = await stack.call(
      alice,
      'DELETE',
      `/conversations/${conv}/messages/${ids[0]}?for=everyone`,
    );
    expect(del.status).toBeLessThan(300);
    const history = await stack.call(bob, 'GET', `/conversations/${conv}/messages`);
    const msgs = history.body.items as any[];
    expect(msgs.find((m) => m.message_id === ids[0])?.content).toBeNull();
    expect(msgs.find((m) => m.message_id === ids[1])?.content.album.index).toBe(1);
  });

  it('refuses inconsistent album metadata with a clear error', async () => {
    const alice = await stack.user('alice3');
    const bob = await stack.user('bob3');
    const conv = await direct(stack, alice, bob);
    const att = await attachment(stack.db, alice, 'image');
    const base = { type: 'image', attachment_id: att, width: 10, height: 10 };
    const bad = [
      meta(randomUUID(), 3, 3), // index must be below count
      meta(randomUUID(), 0, LIMITS.MAX_ALBUM_ITEMS + 1), // more than the maximum
      { ...meta(randomUUID(), 0, 2), videos: 5 }, // more videos than items
      { id: 'nope', index: 0, count: 2 },
    ];
    for (const album of bad) {
      const res = await send(stack, alice, conv, { ...base, album });
      expect(res.status, JSON.stringify(album)).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/album/);
    }
    // Nothing was stored.
    const history = await stack.call(bob, 'GET', `/conversations/${conv}/messages`);
    expect((history.body.items as any[]).filter((m) => m.content?.album)).toHaveLength(0);
  });
});
