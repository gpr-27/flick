import { describe, expect, it } from 'vitest';
import { actionForKey } from '../settings/shortcuts';

const k = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('actionForKey', () => {
  it('opens the palette even while typing', () => {
    expect(actionForKey(k('k', { metaKey: true }), true)).toBe('palette');
  });
  it('ignores plain keys while typing', () => {
    expect(actionForKey(k('?'), true)).toBeNull();
    expect(actionForKey(k('/'), true)).toBeNull();
  });
  it('maps plain keys outside inputs', () => {
    expect(actionForKey(k('?'), false)).toBe('help');
    expect(actionForKey(k('/'), false)).toBe('search');
    expect(actionForKey(k('ArrowDown', { altKey: true }), true)).toBe('nextChat');
  });
});
