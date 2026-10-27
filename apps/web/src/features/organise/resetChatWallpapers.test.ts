import { describe, expect, it } from 'vitest';
import { makeConversation } from '../../../test/fakes';
import { chatsWithOwnWallpaper, resetChatWallpapers } from './resetChatWallpapers';

describe('chatsWithOwnWallpaper', () => {
  it('lists only chats with an override (direct, group, saved, Flick alike)', () => {
    const mk = (id: string, wallpaper: string | null, extra = {}) => {
      const base = makeConversation({ id, ...extra });
      return { ...base, prefs: { ...base.prefs, wallpaper } };
    };
    const all = {
      a: mk('a', 'mint'),
      b: mk('b', null),
      c: mk('c', 'custom:x', { is_saved: true }),
      d: mk('d', 'night', { type: 'group' }),
    };
    expect(chatsWithOwnWallpaper(all).sort()).toEqual(['a', 'c', 'd']);
  });
});

describe('resetChatWallpapers', () => {
  it('runs at most 3 at a time and reports progress', async () => {
    let active = 0;
    let peak = 0;
    const progress: number[] = [];
    const ids = Array.from({ length: 10 }, (_, i) => `c${String(i)}`);
    const result = await resetChatWallpapers(ids, {
      clear: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      },
      onProgress: (n) => progress.push(n),
    });
    expect(peak).toBe(3);
    expect(result).toEqual({ done: 10, failed: [] });
    expect(progress.at(-1)).toBe(10);
  });

  it('collects failures and keeps going', async () => {
    const result = await resetChatWallpapers(['a', 'b', 'c'], {
      clear: (id) => (id === 'b' ? Promise.reject(new Error('x')) : Promise.resolve()),
    });
    expect(result).toEqual({ done: 2, failed: ['b'] });
  });

  it('does nothing for an empty list', async () => {
    expect(await resetChatWallpapers([])).toEqual({ done: 0, failed: [] });
  });
});
