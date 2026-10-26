import { describe, expect, it } from 'vitest';
import { parseTimeOfDay, parseWhen, suggestSlots } from '../src/modules/ai/dates.js';

// Wednesday 2026-10-28 10:00 in UTC+2 (08:00Z).
const now = new Date('2026-10-28T08:00:00Z');
const tz = 120;
const local = (iso: string | null) =>
  iso === null ? null : new Date(new Date(iso).getTime() + tz * 60_000).toISOString().slice(0, 16);

describe('parseTimeOfDay', () => {
  it('reads common times', () => {
    expect(parseTimeOfDay('6pm')).toBe(18 * 60);
    expect(parseTimeOfDay('at 6:30 pm')).toBe(18 * 60 + 30);
    expect(parseTimeOfDay('18:45')).toBe(18 * 60 + 45);
    expect(parseTimeOfDay('12am')).toBe(0);
    expect(parseTimeOfDay('noon')).toBe(720);
    expect(parseTimeOfDay('call mom')).toBeNull();
  });
});

describe('parseWhen', () => {
  it('tomorrow with a time', () => {
    expect(local(parseWhen('tomorrow 9am', now, tz))).toBe('2026-10-29T09:00');
  });
  it('a weekday with a time', () => {
    expect(local(parseWhen('Friday 6pm', now, tz))).toBe('2026-10-30T18:00');
  });
  it('the same weekday means next week when the time passed', () => {
    expect(local(parseWhen('Wednesday 9am', now, tz))).toBe('2026-11-04T09:00');
    expect(local(parseWhen('Wednesday 6pm', now, tz))).toBe('2026-10-28T18:00');
  });
  it('relative durations', () => {
    expect(parseWhen('in 2 hours', now, tz)).toBe('2026-10-28T10:00:00.000Z');
    expect(parseWhen('in 30 minutes', now, tz)).toBe('2026-10-28T08:30:00.000Z');
    expect(local(parseWhen('in 3 days at 5pm', now, tz))).toBe('2026-10-31T17:00');
  });
  it('next week is Monday morning', () => {
    expect(local(parseWhen('next week', now, tz))).toBe('2026-11-02T09:00');
  });
  it('only a time moves to tomorrow when it passed', () => {
    expect(local(parseWhen('at 6pm', now, tz))).toBe('2026-10-28T18:00');
    expect(local(parseWhen('at 8am', now, tz))).toBe('2026-10-29T08:00');
  });
  it('local midnight crossing: 23:30 UTC is already tomorrow in UTC+2', () => {
    const late = new Date('2026-10-28T23:30:00Z');
    expect(local(parseWhen('today 8am', late, tz))).toBe('2026-10-29T08:00');
  });
  it('gives up on nonsense', () => {
    expect(parseWhen('whenever', now, tz)).toBeNull();
    expect(parseWhen('', now, tz)).toBeNull();
  });
});

describe('suggestSlots', () => {
  it('skips busy times', () => {
    const target = new Date(parseWhen('Friday 7pm', now, tz)!);
    const busy = [new Date(parseWhen('Friday 7pm', now, tz)!)];
    const slots = suggestSlots(target, busy, tz).map((s) => local(s));
    expect(slots).not.toContain('2026-10-30T19:00');
    expect(slots).toContain('2026-10-30T20:00');
    expect(slots.length).toBe(3);
  });
});
