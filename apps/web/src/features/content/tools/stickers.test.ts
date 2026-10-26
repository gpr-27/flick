import { expect, it } from 'vitest';
import { squareCrop } from './stickers';

it('crops the centred square', () => {
  expect(squareCrop(400, 300)).toEqual({ sx: 50, sy: 0, size: 300 });
  expect(squareCrop(200, 600)).toEqual({ sx: 0, sy: 200, size: 200 });
});
