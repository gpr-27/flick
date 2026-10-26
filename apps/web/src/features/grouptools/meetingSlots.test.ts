import { describe, expect, it } from 'vitest';
import { suggestSlots } from './meetingSlots';

describe('suggestSlots', () => {
  it('gives five future, increasing, distinct slots', () => {
    const now = new Date(2026, 9, 27, 9, 0);
    const slots = suggestSlots(now);
    expect(slots).toHaveLength(5);
    expect(new Set(slots.map((s) => s.getTime())).size).toBe(5);
    expect(slots.every((s, i) => s > now && (i === 0 || s > slots[i - 1]!))).toBe(true);
  });
});
