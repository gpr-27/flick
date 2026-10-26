import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatListItem, MessageRecord } from '@chat/contracts';
import { groupStarred } from '../organise/groupStarred';
import { filterParams } from '../search/searchFilters';
import { ListTabs } from './ListTabs';
import { tagsOf, toggleId, useChatLists } from './useChatLists';

const list = (over: Partial<ChatListItem>): ChatListItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'folder',
  name: 'Work',
  color: null,
  conversation_ids: [],
  ...over,
});

describe('chat lists', () => {
  it('toggles a chat id in and out', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('finds only the tags a chat has', () => {
    const lists = [
      list({ kind: 'tag', conversation_ids: ['c1'] }),
      list({ id: 'x', kind: 'folder', conversation_ids: ['c1'] }),
    ];
    expect(tagsOf(lists, 'c1')).toHaveLength(1);
    expect(tagsOf(lists, 'c2')).toHaveLength(0);
  });

  it('shows list tabs and reports a pick', () => {
    useChatLists.setState({ lists: [list({})], loaded: true });
    let picked: string | null = 'none';
    render(<ListTabs value={null} onChange={(v) => (picked = v)} />);
    screen.getByRole('button', { name: 'Work' }).click();
    expect(picked).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('search filters', () => {
  it('leaves unset filters out', () => {
    expect(filterParams({})).toEqual({});
    expect(filterParams({ media: 'images', starred: true })).toEqual({
      media: 'images',
      starred: 'true',
    });
  });
});

describe('starred grouping', () => {
  const m = (id: string, conv: string): MessageRecord =>
    ({ message_id: id, conversation_id: conv }) as MessageRecord;
  it('groups by chat and filters by text', () => {
    const items = [m('1', 'a'), m('2', 'b'), m('3', 'a')];
    const out = groupStarred(
      items,
      (c) => c,
      (x) => `text ${x.message_id}`,
      '',
    );
    expect(out.map((x) => x.message_id)).toEqual(['1', '3', '2']);
    expect(
      groupStarred(
        items,
        (c) => c,
        (x) => `text ${x.message_id}`,
        'text 2',
      ),
    ).toHaveLength(1);
  });
});
