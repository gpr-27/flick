import { validateUrl, MAX_URL_LENGTH, type UrlPolicy } from './url.js';

export const FIELD_LIMITS = {
  title: 300,
  description: 1_000,
  siteName: 100,
  url: MAX_URL_LENGTH,
} as const;

// C0/C1 controls except tab/newline/CR (those are collapsed to spaces below).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// Zero-width characters, bidi embeddings/overrides/isolates (Trojan-Source
// style spoofing), word joiners, BOM, Hangul fillers, variation selectors and
// interlinear annotation marks. Built from code points so the source stays
// plain ASCII.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
];
const INVISIBLE_CHARS = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => (a === b ? String.fromCodePoint(a) : `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`)).join('')}]`,
  'gu',
);
const TAG_LIKE = /<\/?[a-z!][^>]*>/gi;

function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

/**
 * Normalises untrusted text into a single line of plain text. Clients must
 * still render it as text (never as HTML); this is defence in depth.
 */
export function sanitizeText(input: string | null | undefined, max: number): string | null {
  if (input === null || input === undefined) return null;
  // Bound the work done on hostile input before running regexes over it.
  let value = input.length > max * 8 ? input.slice(0, max * 8) : input;
  value = value.normalize('NFC');
  value = value.replace(TAG_LIKE, ' ');
  value = value.replace(CONTROL_CHARS, '');
  value = value.replace(INVISIBLE_CHARS, '');
  value = value.replace(/\s+/g, ' ').trim();
  if (value === '') return null;
  return truncateCodePoints(value, max);
}

/**
 * Resolves `value` against `base` and keeps it only if it is a public
 * http(s) URL that passes the same policy as a fetch target. URLs that point
 * at private addresses are dropped so that a recipient's client never loads
 * them either.
 */
export function sanitizeUrl(
  value: string | null | undefined,
  base: URL,
  policy: UrlPolicy = {},
): URL | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > FIELD_LIMITS.url) return null;
  try {
    const resolved = new URL(trimmed, base);
    return validateUrl(resolved, policy);
  } catch {
    return null;
  }
}
