import { describe, expect, it } from 'vitest';
import { hintToDate } from './promiseTime';

describe('hintToDate', () => {
  const now = new Date(2026, 9, 27, 10, 0); // Tuesday
  it('maps weekdays to the next one at 9 am', () => {
    const d = hintToDate('friday', now)!;
    expect(d.getDay()).toBe(5);
    expect(d.getHours()).toBe(9);
  });
  it('the same weekday means next week', () => {
    expect(hintToDate('tuesday', now)!.getDate()).toBe(3);
  });
  it('returns null without a hint', () => {
    expect(hintToDate(null, now)).toBeNull();
  });
});
