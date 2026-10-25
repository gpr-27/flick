// Puts the appearance settings on the page: <html> gets a theme, a font size, CSS variables and
// data attributes, and index.css reacts to them. The small script in index.html does the same
// thing before the first paint (a test keeps the two in step).
import type { ThemeMode } from '@/types/domain';
import { useSettingsStore } from './useSettingsStore';
import type { AccentId, FontFamily, FontSize, Settings } from './settingsSchema';

// Two daisyUI themes back light/dark (see tailwind.config.ts).
export const THEMES: Record<ThemeMode, string> = { light: 'pastel-glass', dark: 'pastel-night' };
const PAGE_BG: Record<ThemeMode, string> = { light: '#F4F3FA', dark: '#14111F' };

export const FONT_SIZES_PX: Record<FontSize, number> = {
  small: 14,
  normal: 16,
  large: 18,
  xlarge: 20,
};

/** Font stacks. "Rounded" is the app's own look (Nunito and Quicksand), so it sets nothing. */
export const FONT_FAMILIES: Record<FontFamily, { label: string; css: string | null }> = {
  rounded: { label: 'Rounded', css: null },
  system: { label: 'System', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  serif: { label: 'Serif', css: "Georgia, 'Times New Roman', serif" },
  mono: { label: 'Mono', css: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
};

/** The primary colour as daisyUI's "H S% L%". Violet is the theme's own colour (no override). */
export const ACCENTS: Record<AccentId, { label: string; hsl: string | null; swatch: string }> = {
  violet: { label: 'Violet', hsl: null, swatch: '#7C6CF0' },
  blue: { label: 'Blue', hsl: '217 91% 55%', swatch: 'hsl(217 91% 55%)' },
  green: { label: 'Green', hsl: '152 60% 38%', swatch: 'hsl(152 60% 38%)' },
  orange: { label: 'Orange', hsl: '24 90% 48%', swatch: 'hsl(24 90% 48%)' },
  pink: { label: 'Pink', hsl: '330 75% 55%', swatch: 'hsl(330 75% 55%)' },
  teal: { label: 'Teal', hsl: '175 75% 33%', swatch: 'hsl(175 75% 33%)' },
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
  >,
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
    root.style.setProperty('--pc', '0 0% 100%');
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
