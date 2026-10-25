import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../tailwind.config';

type Rgb = [number, number, number];

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG 2.x contrast ratio between two opaque colours. */
export const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (value: string): Rgb => {
  const h = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};
/** Lay a translucent colour over an opaque one. */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => c * alpha + (bg[i] ?? 0) * (1 - alpha)) as Rgb;

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
/** The text of one theme block of index.css, from its selector to the next top-level block. */
const block = (selector: string): string => {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf('\n}', start));
};
const rgba = (source: string, name: string): { rgb: Rgb; alpha: number } => {
  const m = new RegExp(`${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(
    source,
  );
  if (!m) throw new Error(`${name} not found`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) };
};

const themes = (config.daisyui.themes as Record<string, Record<string, string>>[]).map(
  (t) => Object.entries(t)[0] as [string, Record<string, string>],
);
const themeColors = (name: string): Record<string, string> => {
  const found = themes.find(([n]) => n === name);
  if (!found) throw new Error(name);
  return found[1];
};

const AA = 4.5;
const CASES = [
  { theme: 'pastel-glass', selector: ":root,\n[data-theme='pastel-glass']" },
  { theme: 'pastel-night', selector: "[data-theme='pastel-night']" },
] as const;

describe('meta text contrast (WCAG AA 4.5:1)', () => {
  for (const { theme, selector } of CASES) {
    it(`${theme}: --text-meta and --text-muted pass on every surface`, () => {
      const source = block(selector);
      const colors = themeColors(theme);
      // The solid surfaces text sits on: cards, the app background, dividers/fills, the page.
      const pageBg = hex(/--page-bg:\s*(#[0-9a-f]{6})/i.exec(source)?.[1] ?? '');
      const surfaces: Record<string, Rgb> = {
        'base-100': hex(colors['base-100'] ?? ''),
        'base-200': hex(colors['base-200'] ?? ''),
        'base-300': hex(colors['base-300'] ?? ''),
        page: pageBg,
      };
      for (const token of ['--text-meta', '--text-muted']) {
        const { rgb, alpha } = rgba(source, token);
        for (const [surface, bg] of Object.entries(surfaces)) {
          const ratio = contrast(over(rgb, alpha, bg), bg);
          expect(
            ratio,
            `${theme} ${token} on ${surface}: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    });
  }

  it('the /50 and /60 text utilities resolve to the checked token', () => {
    expect(css).toMatch(
      /html \.text-base-content\\\/60,\s*html \.text-base-content\\\/50\s*{\s*color: var\(--text-meta\)/,
    );
  });
});

describe('phone and motion rules in index.css', () => {
  it('honors prefers-reduced-motion, including bouncing and drifting elements', () => {
    const rule = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rule).toContain('.animate-bounce');
    expect(rule).toContain('.blobs::before');
    expect(rule).toMatch(/animation-duration:\s*0\.01ms !important/);
  });

  it('gives small buttons a 44px hit area on touch screens', () => {
    const rule = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(rule).toContain('.btn-xs::after');
    expect(rule).toContain('max(100%, 2.75rem)');
  });

  it('text fields are at least 16px on touch screens, so iPhone Safari never zooms in on focus', () => {
    const rule = css.slice(css.lastIndexOf('@media (pointer: coarse)'));
    expect(rule).toMatch(/textarea,\s*select\s*{\s*font-size: 16px !important/);
    expect(rule).toContain("input:not([type='checkbox'])");
    expect(rule).toMatch(/touch-action: manipulation/);
  });

  it('thumb-sized buttons and menu rows keep a pixel floor, whatever the text size is', () => {
    const rule = css.slice(css.lastIndexOf('@media (pointer: coarse)'));
    expect(rule).toMatch(/\.size-11\s*{\s*width: max\(2\.75rem, 44px\)/);
    expect(rule).toMatch(/\.min-h-12\s*{\s*min-height: max\(3rem, 48px\)/);
  });

  it('the page does not switch pinch zoom off (that would be an accessibility problem)', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const viewport = /name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });
});
