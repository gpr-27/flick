// The drafts Flick wrote for one "Describe your message" session, and how a draft goes into the
// message box. Pure: no React, no network.

/** Most drafts kept per session; the oldest are dropped. */
export const MAX_VERSIONS = 10;

/** How a draft goes into a box that already had text: after it (insert) or instead of it. */
export type ComposeApply = 'replace' | 'insert';

export interface Versions {
  items: readonly string[];
  /** Which draft is in the box now; -1 when there are none. */
  index: number;
}

export const NO_VERSIONS: Versions = { items: [], index: -1 };

/** Adds a draft after the others and makes it the current one. */
export const addVersion = (v: Versions, text: string): Versions => {
  const items = [...v.items, text].slice(-MAX_VERSIONS);
  return { items, index: items.length - 1 };
};

/** Moves to the previous (-1) or next (1) draft; stays put at either end. */
export const stepVersion = (v: Versions, delta: -1 | 1): Versions => {
  if (v.items.length === 0) return v;
  return { ...v, index: Math.min(v.items.length - 1, Math.max(0, v.index + delta)) };
};

export const currentVersion = (v: Versions): string | null => v.items[v.index] ?? null;

/** "2 of 3", or null when there is nothing to step through. */
export const versionLabel = (v: Versions): string | null =>
  v.items.length < 2 ? null : `${v.index + 1} of ${v.items.length}`;

/** What the box holds for a draft: the draft alone, or the original text with the draft after it. */
export const placeResult = (base: string, draft: string, how: ComposeApply): string =>
  how === 'insert' && base.trim() !== '' ? `${base.replace(/\s+$/, '')}\n${draft}` : draft;

/** `text` with the part between `start` and `end` swapped for `replacement`. */
export const replaceRange = (
  text: string,
  start: number,
  end: number,
  replacement: string,
): string => text.slice(0, start) + replacement + text.slice(end);
