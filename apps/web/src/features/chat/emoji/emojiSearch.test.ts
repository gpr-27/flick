import { beforeEach, describe, expect, it } from 'vitest';
import { pushRecentEmoji, readRecentEmojis, searchEmojis } from './emojiSearch';

describe('emoji search', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds by name and keyword', () => {
    expect(searchEmojis('thumb')).toContain('👍');
    expect(searchEmojis('thumbs up')).toEqual(['👍']);
    expect(searchEmojis('LOL')).toContain('😂');
    expect(searchEmojis('zzzzz')).toEqual([]);
    expect(searchEmojis('  ')).toEqual([]);
  });

  it('keeps recents newest first without duplicates', () => {
    pushRecentEmoji('🔥');
    pushRecentEmoji('🎉');
    pushRecentEmoji('🔥');
    expect(readRecentEmojis()).toEqual(['🔥', '🎉']);
  });
});
