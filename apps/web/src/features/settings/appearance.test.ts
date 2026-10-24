import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENTS, FONT_SIZES_PX, applyAppearance, effectiveTheme } from './appearance';
import { DEFAULT_SETTINGS, type Settings } from './settingsSchema';
import { SETTINGS_KEY } from './useSettingsStore';

const light = { prefersDark: false, prefersReducedMotion: false };
const root = () => document.documentElement;
const apply = (patch: Partial<Settings>, env = light) =>
  applyAppearance({ ...DEFAULT_SETTINGS, ...patch }, env);

beforeEach(() => {
  root().removeAttribute('style');
  for (const a of ['data-theme', 'data-density', 'data-corners', 'data-motion'])
    root().removeAttribute(a);
});

describe('applyAppearance', () => {
  it('sets the root font size for each text size (normal leaves the browser default)', () => {
    for (const [size, px] of Object.entries(FONT_SIZES_PX)) {
      apply({ fontSize: size as Settings['fontSize'] });
      expect(root().style.fontSize).toBe(size === 'normal' ? '' : `${String(px)}px`);
    }
    apply({ fontSize: 'xlarge' });
    expect(root().style.fontSize).toBe('20px');
  });

  it('sets and clears the accent colour variable', () => {
    apply({ accent: 'green' });
    expect(root().style.getPropertyValue('--p')).toBe(ACCENTS.green.hsl);
    apply({ accent: 'violet' });
    expect(root().style.getPropertyValue('--p')).toBe('');
  });

  it('has six accent presets', () => {
    expect(Object.keys(ACCENTS)).toHaveLength(6);
  });

  it('sets the font family variables, and clears them for the rounded default', () => {
    apply({ fontFamily: 'serif' });
    expect(root().style.getPropertyValue('--app-font')).toContain('Georgia');
    apply({ fontFamily: 'mono' });
    expect(root().style.getPropertyValue('--display-font')).toContain('monospace');
    apply({ fontFamily: 'rounded' });
    expect(root().style.getPropertyValue('--app-font')).toBe('');
  });

  it('sets density and corner attributes for the stylesheet', () => {
    apply({ density: 'compact', corners: 'sharp' });
    expect(root().getAttribute('data-density')).toBe('compact');
    expect(root().getAttribute('data-corners')).toBe('sharp');
  });

  it('reduces motion when asked, or when the device asks', () => {
    apply({ reduceMotion: false });
    expect(root().getAttribute('data-motion')).toBe('full');
    apply({ reduceMotion: true });
    expect(root().getAttribute('data-motion')).toBe('reduce');
    apply({ reduceMotion: false }, { ...light, prefersReducedMotion: true });
    expect(root().getAttribute('data-motion')).toBe('reduce');
  });

  it('system theme follows the device; light and dark do not', () => {
    expect(effectiveTheme('system', { ...light, prefersDark: true })).toBe('dark');
    expect(effectiveTheme('system', light)).toBe('light');
    expect(effectiveTheme('light', { ...light, prefersDark: true })).toBe('light');
    apply({ theme: 'system' }, { ...light, prefersDark: true });
    expect(root().getAttribute('data-theme')).toBe('pastel-night');
    apply({ theme: 'dark' });
    expect(root().getAttribute('data-theme')).toBe('pastel-night');
    expect(root().style.colorScheme).toBe('dark');
  });
});

/** Runs a script in the test page the way the browser runs the one in index.html. */
const runInPage = (code: string): void => {
  const el = document.createElement('script');
  el.textContent = code;
  document.head.append(el);
  el.remove();
};

describe('the script in index.html (applies settings before the first paint)', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  const runScript = (stored: Partial<Settings> | null) => {
    root().removeAttribute('style');
    if (stored) localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: stored, version: 1 }));
    else localStorage.removeItem(SETTINGS_KEY);
    runInPage(script);
  };
  const snapshot = () => ({
    theme: root().getAttribute('data-theme'),
    fontSize: root().style.fontSize,
    accent: root().style.getPropertyValue('--p'),
    font: root().style.getPropertyValue('--app-font'),
    density: root().getAttribute('data-density'),
    corners: root().getAttribute('data-corners'),
    motion: root().getAttribute('data-motion'),
  });

  it('is in the page', () => {
    expect(script).toContain('flick.settings.v1');
  });

  it('gives the same result as applyAppearance for a set of settings', () => {
    const cases: Partial<Settings>[] = [
      {},
      { theme: 'dark', accent: 'orange', fontSize: 'large', density: 'compact' },
      { theme: 'light', accent: 'teal', fontSize: 'small', corners: 'sharp', reduceMotion: true },
      { fontSize: 'xlarge', accent: 'pink', fontFamily: 'serif' },
      { fontFamily: 'mono', accent: 'blue' },
    ];
    for (const patch of cases) {
      runScript(patch);
      const fromScript = snapshot();
      root().removeAttribute('style');
      apply(patch);
      expect(fromScript).toEqual(snapshot());
    }
  });

  it('does not throw with nothing or garbage saved', () => {
    runScript(null);
    localStorage.setItem(SETTINGS_KEY, '{oops');
    expect(() => {
      runInPage(script);
    }).not.toThrow();
  });
});
