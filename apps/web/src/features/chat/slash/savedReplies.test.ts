import { describe, expect, it } from 'vitest';
import { cleanShortcut, expandSaved, matchSaved, upsertReply } from './savedReplies';

describe('saved replies', () => {
  const list = upsertReply([], '/OMW', ' On my way ')!;
  it('cleans and stores', () => {
    expect(cleanShortcut('/Om-W')).toBe('omw');
    expect(list).toEqual([{ shortcut: 'omw', text: 'On my way' }]);
  });
  it('rejects built-ins and empties', () => {
    expect(upsertReply([], 'poll', 'x')).toBeNull();
    expect(upsertReply([], 'a', ' ')).toBeNull();
  });
  it('matches and expands', () => {
    expect(matchSaved('/om', list)).toHaveLength(1);
    expect(matchSaved('hi', list)).toHaveLength(0);
    expect(expandSaved('/omw', list)).toBe('On my way');
    expect(expandSaved('/x', list)).toBeNull();
  });
});
