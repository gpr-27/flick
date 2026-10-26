// Puts the appearance settings on the page: <html> gets a theme, a font size, CSS variables and
// data attributes, and index.css reacts to them. The small script in index.html does the same
// thing before the first paint (a test keeps the two in step).
import type { ThemeMode } from '@/types/domain';
import { useSettingsStore } from './useSettingsStore';
import type { AccentId, FontFamily, FontSize, Settings } from './settingsSchema';

// Two daisyUI themes back light/dark (see tailwind.config.ts).
export const THEMES: Record<ThemeMode, string> = { light: 'pastel-glass', dark: 'pastel-night' };
const PAGE_BG: Record<ThemeMode, string> = { light: '#F5F4FA', dark: '#121019' };

export const FONT_SIZES_PX: Record<FontSize, number> = {
  small: 14,
  normal: 16,
  large: 18,
  xlarge: 20,
};

/** Font stacks. "Rounded" is the app's own look (the system UI font), so it sets nothing. */
export const FONT_FAMILIES: Record<FontFamily, { label: string; css: string | null }> = {
  rounded: { label: 'Rounded', css: null },
  system: {
    label: 'System',
    css: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Helvetica Neue', Inter, system-ui, sans-serif",
  },
  serif: { label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
};

/** The primary colour as daisyUI's "H S% L%". Violet is the theme's own colour (no override). */
export const ACCENTS: Record<AccentId, { label: string; hsl: string | null; swatch: string }> = {
  violet: { label: 'Violet', hsl: null, swatch: '#6252E0' },
  blue: { label: 'Blue', hsl: '58.69% 0.2079 260', swatch: 'hsl(58.69% 0.2079 260)' },
  green: { label: 'Green', hsl: '61.3% 0.1307 157.82', swatch: 'hsl(61.3% 0.1307 157.82)' },
  orange: { label: 'Orange', hsl: '65.99% 0.1832 45.61', swatch: 'hsl(65.99% 0.1832 45.61)' },
  pink: { label: 'Pink', hsl: '62.11% 0.218 355.32', swatch: 'hsl(62.11% 0.218 355.32)' },
  teal: { label: 'Teal', hsl: '59.94% 0.1013 185.77', swatch: 'hsl(59.94% 0.1013 185.77)' },
};

export interface Environment {
  prefersDark: boolean;
  prefersReducedMotion: boolean;
}

export const readEnvironment = (): Environment => {
  const matches = (query: string): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches;
  return {
    prefersDark: matches('(prefers-color-scheme: dark)'),
    prefersReducedMotion: matches('(prefers-reduced-motion: reduce)'),
  };
};

/** "System" follows the operating system. */
export const effectiveTheme = (theme: Settings['theme'], env: Environment): ThemeMode =>
  theme === 'system' ? (env.prefersDark ? 'dark' : 'light') : theme;

/** Applies the settings to <html>. Returns the theme that is showing. */
export function applyAppearance(
  settings: Pick<
    Settings,
    'theme' | 'accent' | 'fontSize' | 'fontFamily' | 'density' | 'corners' | 'reduceMotion'
  > &
    Partial<Pick<Settings, 'dyslexiaFont' | 'highContrast'>>,
  env: Environment = readEnvironment(),
  root: HTMLElement = document.documentElement,
): ThemeMode {
  const mode = effectiveTheme(settings.theme, env);
  root.setAttribute('data-theme', THEMES[mode]);
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PAGE_BG[mode]);

  const accent = ACCENTS[settings.accent].hsl;
  if (accent) {
    root.style.setProperty('--p', accent);
    root.style.setProperty('--pc', '100% 0 0');
  } else {
    root.style.removeProperty('--p');
    root.style.removeProperty('--pc');
  }

  const family = FONT_FAMILIES[settings.fontFamily].css;
  if (family) {
    root.style.setProperty('--app-font', family);
    root.style.setProperty('--display-font', family);
  } else {
    root.style.removeProperty('--app-font');
    root.style.removeProperty('--display-font');
  }

  // "Normal" leaves the size to the browser, so a person's own browser setting still counts.
  root.style.fontSize =
    settings.fontSize === 'normal' ? '' : `${FONT_SIZES_PX[settings.fontSize]}px`;
  root.toggleAttribute('data-dyslexia', settings.dyslexiaFont === true);
  if (settings.highContrast) root.setAttribute('data-contrast', 'high');
  else root.removeAttribute('data-contrast');
  root.setAttribute('data-density', settings.density);
  root.setAttribute('data-corners', settings.corners);
  root.setAttribute(
    'data-motion',
    settings.reduceMotion || env.prefersReducedMotion ? 'reduce' : 'full',
  );
  return mode;
}

/**
 * Applies the settings now and again whenever they change or the operating system changes its
 * mind (dark mode, reduced motion). Returns a function that stops listening.
 */
export function startAppearance(onTheme?: (mode: ThemeMode) => void): () => void {
  const run = (): void => {
    onTheme?.(applyAppearance(useSettingsStore.getState()));
  };
  run();
  const stopStore = useSettingsStore.subscribe(run);
  const queries =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? [
          window.matchMedia('(prefers-color-scheme: dark)'),
          window.matchMedia('(prefers-reduced-motion: reduce)'),
        ]
      : [];
  for (const q of queries) q.addEventListener('change', run);
  return () => {
    stopStore();
    for (const q of queries) q.removeEventListener('change', run);
  };
}
