import { describe, expect, it } from 'vitest';
import { ME, CONV, makeMessage } from '../../../test/fakes';
import { buildRows, firstUnreadKey, groupPosition } from './threadRows';

const rows = buildRows(
  [
    makeMessage({ message_id: 'a', seq: 1, sender_user_id: 'u2' }),
    makeMessage({ message_id: 'b', seq: 2, sender_user_id: 'u2' }),
    makeMessage({ message_id: 'c', seq: 3, sender_user_id: ME }),
    makeMessage({ message_id: 'd', seq: 4, sender_user_id: 'u2' }),
    makeMessage({ message_id: 'e', seq: 5, sender_user_id: 'u2' }),
  ],
  [],
  CONV,
);

describe('groupPosition', () => {
  it('marks the first and last message of a run from one sender', () => {
    expect(groupPosition(rows, 0)).toEqual({ startsGroup: true, endsGroup: false });
    expect(groupPosition(rows, 1)).toEqual({ startsGroup: false, endsGroup: true });
    expect(groupPosition(rows, 2)).toEqual({ startsGroup: true, endsGroup: true });
  });
});

describe('firstUnreadKey', () => {
  it('finds the oldest of the last N messages from other people', () => {
    expect(firstUnreadKey(rows, ME, 3)).toBe(rows[1]?.key);
    expect(firstUnreadKey(rows, ME, 2)).toBe(rows[3]?.key);
  });
  it('is undefined with nothing unread', () => {
    expect(firstUnreadKey(rows, ME, 0)).toBeUndefined();
  });
});
