import { expect, it } from 'vitest';
import { clampRange, isFullRange, sliceWaveform } from './trim';

it('clamps handles', () => {
  expect(clampRange({ start: -1, end: 2 })).toEqual({ start: 0, end: 1 });
  const r = clampRange({ start: 0.5, end: 0.5 });
  expect(r.end - r.start).toBeCloseTo(0.05);
});
it('detects full range and slices the waveform', () => {
  expect(isFullRange({ start: 0, end: 1 })).toBe(true);
  expect(isFullRange({ start: 0.1, end: 1 })).toBe(false);
  expect(sliceWaveform([1, 2, 3, 4], { start: 0.25, end: 0.75 })).toEqual([2, 3]);
});
