import { describe, expect, it } from 'vitest';
import { addMonths, dayKey, groupByDay, monthGrid } from './month';

describe('month math', () => {
  it('builds 42 days starting on a Monday', () => {
    const grid = monthGrid(2026, 9); // October 2026, the 1st is a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]!.getDay()).toBe(1);
    expect(dayKey(grid[0]!)).toBe('2026-09-28');
    expect(grid.some((d) => dayKey(d) === '2026-10-31')).toBe(true);
  });
  it('rolls over years', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
  it('groups by day in time order', () => {
    const a = new Date(2026, 9, 5, 15).toISOString();
    const b = new Date(2026, 9, 5, 9).toISOString();
    const g = groupByDay([
      { id: '1', kind: 'reminder', at: a, title: 'a' },
      { id: '2', kind: 'scheduled', at: b, title: 'b' },
    ]);
    expect(g.get('2026-10-05')!.map((i) => i.id)).toEqual(['2', '1']);
  });
});
