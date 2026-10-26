import { describe, expect, it } from 'vitest';
import { cropRect, isEditableImage } from './editPhoto';

describe('cropRect', () => {
  it('keeps everything for free', () => {
    expect(cropRect(400, 300, 'free')).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
  it('crops a centered square', () => {
    expect(cropRect(400, 300, '1:1')).toEqual({ x: 50, y: 0, w: 300, h: 300 });
  });
  it('crops 4:3 out of a tall image', () => {
    expect(cropRect(300, 600, '4:3')).toEqual({ x: 0, y: 188, w: 300, h: 225 });
  });
  it('skips gifs', () => {
    expect(isEditableImage({ type: 'image/gif' })).toBe(false);
    expect(isEditableImage({ type: 'image/png' })).toBe(true);
  });
});
