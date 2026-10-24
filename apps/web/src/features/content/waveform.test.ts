import { describe, expect, it } from 'vitest';
import { reduceSamples } from './waveform';

describe('reduceSamples', () => {
  it('gives the requested number of bars, each 0-100, with the loudest at 100', () => {
    const samples = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * (i / 1000));
    const bars = reduceSamples(samples, 48);
    expect(bars).toHaveLength(48);
    expect(Math.max(...bars)).toBe(100);
    expect(bars.every((b) => Number.isInteger(b) && b >= 0 && b <= 100)).toBe(true);
  });

  it('takes the peak of each slice, ignoring the sign', () => {
    expect(reduceSamples([0.1, -0.5, 0.25, 0.25], 2)).toEqual([100, 50]);
  });

  it('uses fewer bars when there are fewer samples', () => {
    expect(reduceSamples([0.2, 0.4], 48)).toEqual([50, 100]);
  });

  it('returns zeros for silence and nothing for no samples', () => {
    expect(reduceSamples(new Float32Array(100), 4)).toEqual([0, 0, 0, 0]);
    expect(reduceSamples([], 48)).toEqual([]);
  });
});
