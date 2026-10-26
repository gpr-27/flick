// Saved replies: "/omw" expands to a text the user saved. Kept in localStorage.
export interface SavedReply {
  shortcut: string; // without the slash, lower case
  text: string;
}

const KEY = 'flick.savedReplies';
const RESERVED = ['poll', 'remind', 'schedule', 'flick'];

export const cleanShortcut = (s: string): string =>
  s
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const isSavedReply = (r: unknown): r is SavedReply =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as Record<string, unknown>).shortcut === 'string' &&
  typeof (r as Record<string, unknown>).text === 'string';

export const loadSavedReplies = (): SavedReply[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r): r is SavedReply => isSavedReply(r)) : [];
  } catch {
    return [];
  }
};

export const saveSavedReplies = (replies: SavedReply[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(replies));
  } catch {
    /* storage unavailable: the replies just are not kept */
  }
};

/** Adds or replaces one reply; null when the shortcut or text is empty or a built-in command. */
export const upsertReply = (
  list: SavedReply[],
  shortcut: string,
  text: string,
): SavedReply[] | null => {
  const s = cleanShortcut(shortcut);
  if (!s || !text.trim() || RESERVED.includes(s)) return null;
  return [...list.filter((r) => r.shortcut !== s), { shortcut: s, text: text.trim() }];
};

/** Replies whose shortcut starts with what is typed after the slash ("/om" finds omw). */
export const matchSaved = (text: string, list: SavedReply[]): SavedReply[] => {
  const m = /^\/([a-z0-9]*)$/i.exec(text);
  if (!m) return [];
  const prefix = (m[1] ?? '').toLowerCase();
  return list.filter((r) => r.shortcut.startsWith(prefix));
};

/** The text a complete "/omw" stands for, or null. */
export const expandSaved = (text: string, list: SavedReply[]): string | null =>
  list.find((r) => `/${r.shortcut}` === text.trim().toLowerCase())?.text ?? null;
