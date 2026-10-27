import type { MessageRecord } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import { ME, CONV, makeMessage } from '../../../test/fakes';
import { albumStatus, buildRows, groupAlbums } from './threadRows';

const ALBUM = '0190a0a0-0000-7000-8000-0000000000aa';
const photo = (
  n: number,
  index: number,
  count: number,
  extra: Partial<MessageRecord> = {},
  caption?: string,
): MessageRecord =>
  makeMessage({
    message_id: `m${String(n)}`,
    seq: n,
    sender_user_id: ME,
    content: {
      type: index % 2 === 1 ? 'video' : 'image',
      attachment_id: `att${String(n)}`,
      width: 100,
      height: 100,
      ...(index % 2 === 1 ? { duration_ms: 2000 } : {}),
      album: { id: ALBUM, index, count },
      ...(caption ? { caption } : {}),
    } as MessageRecord['content'],
    ...extra,
  });

const group = (messages: MessageRecord[]) => groupAlbums(buildRows(messages, [], CONV));

describe('groupAlbums', () => {
  it('folds consecutive items of one album into one row keyed by the first', () => {
    const messages = [photo(1, 0, 3, {}, 'hello'), photo(2, 1, 3), photo(3, 2, 3)];
    const rows = group(messages);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(buildRows(messages, [], CONV)[0]?.key);
    expect(rows[0]?.album?.count).toBe(3);
    expect(rows[0]?.album?.items.map((r) => r.message.message_id)).toEqual(['m1', 'm2', 'm3']);
    expect(rows[0]?.album?.caption).toBe('hello');
  });

  it('orders items by their index even when they arrive out of order', () => {
    const rows = group([photo(1, 0, 3), photo(2, 2, 3), photo(3, 1, 3)]);
    expect(rows[0]?.album?.items.map((r) => r.message.message_id)).toEqual(['m1', 'm3', 'm2']);
  });

  it('leaves a gap for items that never arrived', () => {
    const rows = group([photo(1, 0, 4), photo(2, 3, 4)]);
    expect(rows[0]?.album?.slots.map((s) => s?.message.message_id ?? null)).toEqual([
      'm1',
      null,
      null,
      'm2',
    ]);
  });

  it('does not join other senders, other albums or a message in between', () => {
    const other = photo(2, 1, 3, { sender_user_id: 'u2' });
    const text = makeMessage({ message_id: 't', seq: 2, sender_user_id: ME });
    expect(group([photo(1, 0, 3), other, photo(3, 2, 3)])).toHaveLength(3);
    expect(group([photo(1, 0, 2), text, photo(3, 1, 2)])).toHaveLength(3);
  });

  it('keeps an album together across an item that was deleted for everyone', () => {
    const deleted = makeMessage({
      message_id: 'gone',
      seq: 2,
      sender_user_id: ME,
      content: null,
      deleted_at: '2026-01-01T12:00:00Z',
    });
    const rows = group([photo(1, 0, 3), deleted, photo(3, 2, 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.album?.slots.map((s) => s?.message.message_id ?? null)).toEqual([
      'm1',
      null,
      'm3',
    ]);
  });

  it('leaves messages without album metadata alone', () => {
    const plain = makeMessage({
      sender_user_id: ME,
      content: { type: 'image', attachment_id: 'x', width: 1, height: 1 },
    });
    const rows = group([plain, plain]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.album).toBeUndefined();
  });
});

describe('albumStatus', () => {
  it('is as far along as the slowest item', () => {
    expect(albumStatus(['read', 'delivered', 'read'])).toBe('delivered');
    expect(albumStatus(['sent', 'pending'])).toBe('pending');
    expect(albumStatus(['read', 'failed'])).toBe('failed');
  });
});
