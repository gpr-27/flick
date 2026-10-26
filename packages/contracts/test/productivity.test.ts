import { describe, expect, it } from 'vitest';
import { isQuietNow } from '../src/index.js';

const base = {
  quiet_enabled: true,
  quiet_start: '22:00',
  quiet_end: '07:00',
  quiet_timezone: 'UTC',
  quiet_days: [0, 1, 2, 3, 4, 5, 6],
};

describe('isQuietNow', () => {
  it('covers a window that crosses midnight', () => {
    expect(isQuietNow(base, new Date('2026-10-27T23:30:00Z'))).toBe(true);
    expect(isQuietNow(base, new Date('2026-10-27T06:59:00Z'))).toBe(true);
    expect(isQuietNow(base, new Date('2026-10-27T12:00:00Z'))).toBe(false);
  });
  it('is off when disabled or the day is not chosen', () => {
    expect(isQuietNow({ ...base, quiet_enabled: false }, new Date('2026-10-27T23:30:00Z'))).toBe(
      false,
    );
    // 2026-10-27 is a Tuesday (2); only Monday chosen.
    expect(isQuietNow({ ...base, quiet_days: [1] }, new Date('2026-10-27T23:30:00Z'))).toBe(false);
    expect(isQuietNow({ ...base, quiet_days: [1] }, new Date('2026-10-27T03:00:00Z'))).toBe(true);
  });
});
