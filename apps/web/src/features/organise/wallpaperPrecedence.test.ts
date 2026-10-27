import { describe, expect, it } from 'vitest';
import { resolveWallpaperId, wallpaperSource } from './wallpaperPrecedence';

describe('wallpaper precedence: chat > all chats > normal background', () => {
  it('uses the chat own wallpaper first', () => {
    expect(resolveWallpaperId('mint', 'night')).toBe('mint');
    expect(wallpaperSource('mint', 'night')).toBe('chat');
  });
  it('falls back to the global one', () => {
    expect(resolveWallpaperId(null, 'night')).toBe('night');
    expect(resolveWallpaperId(undefined, 'night')).toBe('night');
    expect(wallpaperSource(null, 'night')).toBe('global');
  });
  it('is null (normal background) when neither is set', () => {
    expect(resolveWallpaperId(null, null)).toBeNull();
    expect(wallpaperSource(null, null)).toBe('none');
  });
});
