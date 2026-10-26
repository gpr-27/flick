import { expect, it } from 'vitest';
import { ringOffset } from './ringOffset';

it('maps fraction to dash offset, clamped', () => {
  expect(ringOffset(0, 100)).toBe(100);
  expect(ringOffset(0.25, 100)).toBe(75);
  expect(ringOffset(2, 100)).toBe(0);
  expect(ringOffset(-1, 100)).toBe(100);
});
