import { expect, it } from 'vitest';
import { nextUnplayed } from './playQueue';

it('finds the next unplayed note', () => {
  expect(nextUnplayed([true, true, false, false], 0)).toBe(2);
  expect(nextUnplayed([false, true, true], 0)).toBe(-1);
  expect(nextUnplayed([false, false], 1)).toBe(-1);
});
