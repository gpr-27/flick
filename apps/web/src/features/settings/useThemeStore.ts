import { create } from 'zustand';
import type { ThemeMode } from '@/types/domain';
import {
  THEMES,
  applyAppearance,
  effectiveTheme,
  readEnvironment,
  startAppearance,
} from './appearance';
import { useSettingsStore } from './useSettingsStore';

// The theme the page is showing right now ("light" or "dark"). What the person chose, including
// "system", is the `theme` setting in useSettingsStore; this store is the quick sun/moon switch
// that the navbar uses, and it keeps `theme` in step with the settings and the operating system.

interface ThemeState {
  /** The theme that is showing. */
  theme: ThemeMode;
  /** Apply the saved appearance now and keep it applied (safety net if the <head> script was blocked). */
  initTheme: () => void;
  /** Choose light or dark explicitly. */
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

let stopAppearance: (() => void) | null = null;

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: effectiveTheme(useSettingsStore.getState().theme, readEnvironment()),
  initTheme: () => {
    stopAppearance?.();
    stopAppearance = startAppearance((theme) => {
      set({ theme });
    });
  },
  setTheme: (mode) => {
    if (!Object.hasOwn(THEMES, mode)) return;
    useSettingsStore.getState().update({ theme: mode });
    set({ theme: applyAppearance(useSettingsStore.getState()) });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
}));
