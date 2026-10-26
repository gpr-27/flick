import { describe, expect, it } from 'vitest';
import { clampZoom, galleryItems, stepIndex } from './gallery';

describe('gallery', () => {
  it('keeps indexes and zoom in range', () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(clampZoom(9)).toBe(5);
    expect(clampZoom(0.2)).toBe(1);
  });
  it('lists only photos and videos', () => {
    const msg = (content: unknown, deleted_at: string | null = null) =>
      ({ content, deleted_at }) as never;
    const items = galleryItems([
      msg({ type: 'text', text: 'hi' }),
      msg({ type: 'image', attachment_id: 'a' }),
      msg({ type: 'video', attachment_id: 'b', caption: 'c' }),
      msg({ type: 'image', attachment_id: 'x' }, 'now'),
    ]);
    expect(items.map((i) => i.attachmentId)).toEqual(['a', 'b']);
  });
});
