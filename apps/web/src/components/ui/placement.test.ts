import { describe, expect, it } from 'vitest';
import { computePlacement } from './placement';

const viewport = { width: 400, height: 800 };
const box = (top: number, left: number, w = 40, h = 40) => ({
  top,
  left,
  right: left + w,
  bottom: top + h,
});

describe('computePlacement', () => {
  it('opens below the anchor when there is room', () => {
    const p = computePlacement({
      anchor: box(100, 300),
      panel: { width: 200, height: 300 },
      viewport,
    });
    expect(p.side).toBe('down');
    expect(p.top).toBe(144);
    expect(p.left).toBe(140); // right-aligned with the anchor
  });

  it('flips above when it does not fit below but fits above', () => {
    const p = computePlacement({
      anchor: box(700, 300),
      panel: { width: 200, height: 300 },
      viewport,
    });
    expect(p.side).toBe('up');
    expect(p.top).toBe(700 - 4 - 300);
  });

  it('keeps the side with more room and limits the height when neither fits', () => {
    const p = computePlacement({
      anchor: box(300, 20),
      panel: { width: 200, height: 900 },
      viewport,
    });
    expect(p.side).toBe('down');
    expect(p.maxHeight).toBe(800 - 340 - 4 - 8);
    expect(p.top).toBe(344);
  });

  it('shifts back inside the viewport on the left and right', () => {
    const l = computePlacement({
      anchor: box(10, 0, 10),
      panel: { width: 300, height: 50 },
      viewport,
    });
    expect(l.left).toBe(8);
    const r = computePlacement({
      anchor: box(10, 380, 10),
      panel: { width: 300, height: 50 },
      viewport,
      align: 'left',
    });
    expect(r.left).toBe(400 - 8 - 300);
  });

  it('never exceeds the viewport width', () => {
    const p = computePlacement({
      anchor: box(10, 10),
      panel: { width: 900, height: 50 },
      viewport,
    });
    expect(p.maxWidth).toBe(384);
    expect(p.left).toBe(8);
  });

  it('honours prefer=up and flips down when above is too small', () => {
    expect(
      computePlacement({
        anchor: box(500, 10),
        panel: { width: 100, height: 100 },
        viewport,
        prefer: 'up',
      }).side,
    ).toBe('up');
    expect(
      computePlacement({
        anchor: box(60, 10),
        panel: { width: 100, height: 200 },
        viewport,
        prefer: 'up',
      }).side,
    ).toBe('down');
  });
});
