import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '@chat/contracts';
import { messageLine, transcript } from './exportChat';

const msg = (seq: number, content: unknown, extra: Partial<MessageRecord> = {}): MessageRecord =>
  ({
    message_id: `m${String(seq)}`,
    conversation_id: 'c',
    seq,
    sender_user_id: 'u1',
    client_message_id: null,
    content,
    created_at: '2025-01-31T18:04:00.000Z',
    edited_at: null,
    deleted_at: null,
    expires_at: null,
    reactions: [],
    starred: false,
    viewed: false,
    ...extra,
  }) as MessageRecord;

describe('chat export', () => {
  it('names text, files and deleted messages', () => {
    expect(messageLine(msg(1, { type: 'text', text: 'hi' }))).toBe('hi');
    expect(messageLine(msg(2, { type: 'file', file_name: 'a.pdf', attachment_id: 'x' }))).toBe(
      '[File: a.pdf]',
    );
    expect(messageLine(msg(3, null, { deleted_at: '2025-01-01T00:00:00.000Z' }))).toBe(
      '(message deleted)',
    );
  });

  it('writes one line per message with the sender name', () => {
    const out = transcript([msg(1, { type: 'text', text: 'hello' })], () => 'Alice');
    expect(out).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d - Alice: hello$/);
  });
});

import { unzipSync, strFromU8 } from 'fflate';
import { attachmentRefs, buildZip } from './exportChat';

describe('zip export', () => {
  it('lists attachments with unique paths and builds a readable zip', async () => {
    const msgs = [
      { seq: 3, deleted_at: null, content: { type: 'image', attachment_id: 'a1' } },
      {
        seq: 4,
        deleted_at: null,
        content: { type: 'file', attachment_id: 'a2', file_name: 'my doc.pdf' },
      },
      { seq: 5, deleted_at: null, content: { type: 'text', text: 'hi' } },
    ] as never;
    const refs = attachmentRefs(msgs);
    expect(refs.map((r) => r.path)).toEqual([
      'attachments/00003-image.jpg',
      'attachments/00004-my_doc.pdf',
    ]);
    const blob = await buildZip('hello', [{ path: refs[0]!.path, data: new Uint8Array([1, 2]) }]);
    const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(out['chat.txt']!)).toBe('hello');
    expect(Array.from(out[refs[0]!.path]!)).toEqual([1, 2]);
  });
});
