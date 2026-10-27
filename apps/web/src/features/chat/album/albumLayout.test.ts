import { describe, expect, it } from 'vitest';
import { albumHeightPx, albumLayout } from './albumLayout';

describe('albumLayout', () => {
  it('draws one item in its own proportions, within limits', () => {
    expect(albumLayout(1, 1.2).aspect).toBe(1.2);
    expect(albumLayout(1, 5).aspect).toBe(1.5);
    expect(albumLayout(1, 0.2).aspect).toBe(0.75);
  });

  it('two items: two columns', () => {
    const l = albumLayout(2);
    expect(l.cells.map((c) => c.col)).toEqual([0, 1]);
    expect(new Set(l.cells.map((c) => c.row))).toEqual(new Set([0]));
  });

  it('three items: one large on top and two below', () => {
    const l = albumLayout(3);
    expect(l.cells[0]).toMatchObject({ col: 0, row: 0, colSpan: 2 });
    expect(l.cells.slice(1).map((c) => [c.col, c.row])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it('four items: 2x2 with nothing hidden', () => {
    const l = albumLayout(4);
    expect(l.cells).toHaveLength(4);
    expect(l.hidden).toBe(0);
  });

  it('five or more: 2x2 whose last tile says how many more', () => {
    expect(albumLayout(5).hidden).toBe(2);
    expect(albumLayout(5).cells).toHaveLength(4);
    expect(albumLayout(20).hidden).toBe(17);
  });

  it('reserves a stable height', () => {
    expect(albumHeightPx(4)).toBe(288);
    expect(albumHeightPx(2)).toBe(144);
  });
});
