import { create } from 'zustand';
import type { ThemeMode } from '@/types/domain';

// Two daisyUI themes back light/dark (see tailwind.config.ts). STORAGE_KEY and
// the mapping must match the no-flash <head> script in index.html.
export const THEMES: Record<ThemeMode, string> = { light: 'pastel-glass', dark: 'pastel-night' };
export const THEME_STORAGE_KEY = 'chat-theme';
const PAGE_BG: Record<ThemeMode, string> = { light: '#F4F3FA', dark: '#14111F' };

const isThemeMode = (v: unknown): v is ThemeMode => v === 'light' || v === 'dark';

export const getInitialMode = (): ThemeMode => {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(saved)) return saved;
  } catch {
    // localStorage unavailable (private mode): fall through to the OS preference.
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
};

const applyMode = (mode: ThemeMode): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', THEMES[mode]);
  document.documentElement.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAGE_BG[mode]);
};

interface ThemeState {
  theme: ThemeMode;
  /** Re-assert the DOM from the store (safety net if the <head> script was blocked). */
  initTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  theme: getInitialMode(),
  initTheme: () => {
    applyMode(get().theme);
  },
  setTheme: (mode) => {
    if (!isThemeMode(mode)) return;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore persistence failures
    }
    applyMode(mode);
    set({ theme: mode });
  },
  toggleTheme: () => {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
}));
