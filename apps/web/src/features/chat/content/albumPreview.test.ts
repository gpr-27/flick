import { describe, expect, it } from 'vitest';
import { previewContent } from './registry';

const id = '0190a0a0-0000-7000-8000-0000000000aa';
const image = (album: { index: number; count: number; videos?: number }, caption?: string) =>
  ({
    type: 'image',
    attachment_id: 'a',
    width: 1,
    height: 1,
    album: { id, ...album },
    ...(caption ? { caption } : {}),
  }) as const;

describe('previewContent for albums', () => {
  it('reads like the whole album, not the last item', () => {
    expect(previewContent(image({ index: 3, count: 4 }))).toBe('4 photos');
    expect(previewContent(image({ index: 4, count: 5, videos: 2 }))).toBe('3 photos and 2 videos');
    expect(
      previewContent({
        ...image({ index: 2, count: 3, videos: 3 }),
        type: 'video',
        duration_ms: 1,
      }),
    ).toBe('3 videos');
  });
  it('adds the caption', () => {
    expect(previewContent(image({ index: 0, count: 2 }, 'Beach'))).toBe('2 photos: Beach');
  });
  it('a single item is unchanged', () => {
    expect(previewContent(image({ index: 0, count: 1 }))).toBe('Photo');
    expect(previewContent({ type: 'image', attachment_id: 'a', width: 1, height: 1 })).toBe(
      'Photo',
    );
  });
});
