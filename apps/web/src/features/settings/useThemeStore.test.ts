import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, useThemeStore } from './useThemeStore';

describe('theme store', () => {
  it('toggles light/dark, applies the daisyUI theme and persists the choice', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pastel-night');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    useThemeStore.getState().toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('pastel-glass');
  });
});
