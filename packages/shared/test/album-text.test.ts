import { describe, expect, it } from 'vitest';
import { albumOf, albumText, isSilentAlbumItem, previewOf } from '../src/index.js';

describe('album notification text', () => {
  it('reads the album from stored content', () => {
    expect(albumOf({ type: 'image', album: { id: 'x', index: 0, count: 4 } })).toEqual({
      index: 0,
      count: 4,
    });
    expect(albumOf({ type: 'image' })).toBeNull();
    expect(albumOf(null)).toBeNull();
  });
  it('only the first item of an album alerts', () => {
    expect(isSilentAlbumItem({ index: 0, count: 3 })).toBe(false);
    expect(isSilentAlbumItem({ index: 2, count: 3 })).toBe(true);
    expect(isSilentAlbumItem(null)).toBe(false);
  });
  it('names the album by photos and videos', () => {
    expect(albumText({ count: 4 })).toBe('4 photos');
    expect(albumText({ count: 5, videos: 2 })).toBe('3 photos and 2 videos');
    expect(previewOf({ type: 'image', bodyText: null, album: { index: 0, count: 4 } })).toBe(
      'Sent you 4 photos',
    );
    expect(
      previewOf({ type: 'image', bodyText: 'Trip', album: { index: 0, count: 3, videos: 1 } }),
    ).toBe('2 photos and 1 video: Trip');
  });
});
