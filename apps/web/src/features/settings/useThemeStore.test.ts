import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY, useSettingsStore } from './useSettingsStore';
import { useThemeStore } from './useThemeStore';

describe('theme store', () => {
  it('toggles light/dark, applies the daisyUI theme and saves the choice in the settings', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().toggleTheme();

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pastel-night');
    expect(useSettingsStore.getState().theme).toBe('dark');
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as {
      state: { theme: string };
    };
    expect(saved.state.theme).toBe('dark');

    useThemeStore.getState().toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('pastel-glass');
  });

  it('ignores a theme that does not exist', () => {
    useThemeStore.getState().setTheme('light');
    useThemeStore.getState().setTheme('purple' as never);
    expect(useThemeStore.getState().theme).toBe('light');
  });
});
