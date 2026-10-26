import { describe, expect, it } from 'vitest';
import { digestLines, holdForDigest, setDigestHours } from './digest';
import { suggestList } from '../lists/sortRules';
import type { ChatListItem, ConversationSummary } from '@chat/contracts';

describe('digest', () => {
  it('holds quiet messages only when a digest is on, and words one line per chat', () => {
    setDigestHours(0);
    expect(holdForDigest('c1', 'Maya', 'hi', false)).toBe(false);
    setDigestHours(3);
    expect(holdForDigest('c1', 'Maya', 'hi', false)).toBe(true);
    expect(holdForDigest('c1', 'Maya', 'asap please', false)).toBe(false);
    expect(holdForDigest('c1', 'Maya', 'hi', true)).toBe(false);
    expect(digestLines([{ title: 'Maya', count: 3, conversationId: 'c1' }])).toEqual([
      'Maya: 3 new messages',
    ]);
    setDigestHours(0);
  });
});

describe('suggestList', () => {
  const lists = [
    { id: 'l1', name: 'Work', kind: 'folder', conversation_ids: [] },
    { id: 'l2', name: 'Friends', kind: 'tag', conversation_ids: ['c9'] },
  ] as unknown as ChatListItem[];
  const chat = (o: object) =>
    ({
      id: 'c1',
      type: 'direct',
      title: null,
      last_message: null,
      ...o,
    }) as unknown as ConversationSummary;
  it('matches names, then chat type, and skips chats already filed', () => {
    expect(suggestList(chat({ title: 'Work stuff', type: 'group' }), lists)?.id).toBe('l1');
    expect(suggestList(chat({}), lists)?.id).toBe('l2');
    expect(suggestList(chat({ id: 'c9' }), lists)).toBeNull();
  });
});
