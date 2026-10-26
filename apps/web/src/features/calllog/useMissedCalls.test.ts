import { describe, expect, it } from 'vitest';
import type { CallLogEntry } from '../groupcall/types';
import { countMissed } from './useMissedCalls';
import { shouldRelock } from '../settings/screenLock';

const entry = (over: Partial<CallLogEntry>): CallLogEntry =>
  ({
    call_id: 'c',
    outcome: 'missed',
    direction: 'incoming',
    started_at: '2026-01-02T00:00:00Z',
    ...over,
  }) as CallLogEntry;

describe('countMissed', () => {
  it('counts only missed incoming calls after the last visit', () => {
    const seen = Date.parse('2026-01-01T00:00:00Z');
    const list = [
      entry({}),
      entry({ outcome: 'ended' }),
      entry({ direction: 'outgoing' }),
      entry({ started_at: '2025-12-31T00:00:00Z' }),
    ];
    expect(countMissed(list, seen)).toBe(1);
  });
});

describe('shouldRelock', () => {
  it('only after the chosen time away', () => {
    expect(shouldRelock(0, 4 * 60_000, 5)).toBe(false);
    expect(shouldRelock(0, 5 * 60_000, 5)).toBe(true);
    expect(shouldRelock(0, 99 * 60_000, 0)).toBe(false);
  });
});
