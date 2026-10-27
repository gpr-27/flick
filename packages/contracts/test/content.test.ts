import { describe, expect, it } from 'vitest';
import { albumLabel, LIMITS, MessageContent, mentionsFlick } from '../src/index.js';
import { CONTENT, MSG } from './fixtures.js';

describe('message content', () => {
  it('accepts one example of every type', () => {
    for (const example of Object.values(CONTENT))
      expect(MessageContent.safeParse(example).success, example.type).toBe(true);
  });

  it('rejects bad content', () => {
    const bad = [
      { type: 'text', text: '   ' }, // blank
      { type: 'hologram' },
      { type: 'location', lat: 1, lng: 1 }, // dropped type
      { ...CONTENT.poll, options: ['Pizza'] }, // too few options
      { ...CONTENT.poll, options: ['Pizza', 'Pizza'] }, // duplicates
      { ...CONTENT.voice, waveform: [101] }, // sample out of range
      { ...CONTENT.gif, url: 'javascript:alert(1)' },
      { ...CONTENT.text, reply_to: 'not-a-uuid' },
    ];
    for (const content of bad)
      expect(MessageContent.safeParse(content).success, JSON.stringify(content)).toBe(false);
  });

  it('every type takes reply_to, forwarded, view_once and mentions', () => {
    const extras = { reply_to: MSG, forwarded: true, view_once: true, mentions: [] };
    for (const example of Object.values(CONTENT))
      expect(MessageContent.safeParse({ ...example, ...extras }).success, example.type).toBe(true);
  });

  it('detects @flick mentions', () => {
    expect(mentionsFlick('@flick what is 2+2?')).toBe(true);
    expect(mentionsFlick('hey @Flick, summarise this')).toBe(true);
    expect(mentionsFlick('email me at bob@flick.com')).toBe(false);
    expect(mentionsFlick('@flickering lights')).toBe(false);
  });

  describe('album metadata', () => {
    const id = '0190a0a0-0000-7000-8000-000000000001';
    const withAlbum = (type: 'image' | 'video', album: unknown): unknown => ({
      ...CONTENT[type],
      album,
    });

    it('accepts photos and videos that belong to an album', () => {
      for (const type of ['image', 'video'] as const) {
        expect(MessageContent.safeParse(withAlbum(type, { id, index: 0, count: 1 })).success).toBe(
          true,
        );
        expect(
          MessageContent.safeParse(withAlbum(type, { id, index: 19, count: 20, videos: 4 }))
            .success,
        ).toBe(true);
      }
    });

    it('stays optional, so older senders keep working', () => {
      expect(MessageContent.safeParse(CONTENT.image).success).toBe(true);
    });

    it('rejects inconsistent metadata with a clear message', () => {
      const bad = [
        { id, index: 3, count: 3 }, // index must be below count
        { id, index: 0, count: LIMITS.MAX_ALBUM_ITEMS + 1 }, // over the limit
        { id, index: LIMITS.MAX_ALBUM_ITEMS, count: LIMITS.MAX_ALBUM_ITEMS },
        { id, index: 0, count: 0 },
        { id, index: -1, count: 2 },
        { id, index: 0, count: 2, videos: 3 }, // more videos than items
        { id: 'not-a-uuid', index: 0, count: 2 },
        { index: 0, count: 2 },
      ];
      for (const album of bad)
        expect(
          MessageContent.safeParse(withAlbum('image', album)).success,
          JSON.stringify(album),
        ).toBe(false);
      const result = MessageContent.safeParse(withAlbum('video', { id, index: 5, count: 3 }));
      expect(result.success ? '' : result.error.issues.map((i) => i.message).join()).toMatch(
        /smaller than count/,
      );
    });

    it('limits are the numbers the product promises', () => {
      expect(LIMITS.MAX_ALBUM_ITEMS).toBe(20);
      expect(LIMITS.MAX_ALBUM_BYTES).toBe(2 * 1024 ** 3);
      expect(LIMITS.MAX_ALBUM_BYTES).toBeGreaterThan(LIMITS.MAX_UPLOAD_BYTES);
    });

    it('names an album for the chat list', () => {
      expect(albumLabel({ count: 4 })).toBe('4 photos');
      expect(albumLabel({ count: 1 })).toBe('1 photo');
      expect(albumLabel({ count: 3, videos: 3 })).toBe('3 videos');
      expect(albumLabel({ count: 5, videos: 2 })).toBe('3 photos and 2 videos');
      expect(albumLabel({ count: 2, videos: 1 })).toBe('1 photo and 1 video');
    });
  });
});
