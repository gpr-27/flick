// ":smile:" emoji shortcodes: suggestions while typing ":smi", Enter or Tab to insert.
import { useCallback, useState, type KeyboardEvent } from 'react';

/** The common ones. Kept short on purpose; the emoji picker has the rest. */
export const SHORTCODES: Readonly<Record<string, string>> = {
  smile: '😄',
  grin: '😁',
  joy: '😂',
  rofl: '🤣',
  wink: '😉',
  blush: '😊',
  heart_eyes: '😍',
  kiss: '😘',
  sunglasses: '😎',
  thinking: '🤔',
  roll_eyes: '🙄',
  sleepy: '😴',
  cry: '😭',
  sweat_smile: '😅',
  party: '🥳',
  star_struck: '🤩',
  thumbsup: '👍',
  thumbsdown: '👎',
  pray: '🙏',
  clap: '👏',
  raised_hands: '🙌',
  muscle: '💪',
  fire: '🔥',
  sparkles: '✨',
  tada: '🎉',
  heart: '❤️',
  hundred: '💯',
  eyes: '👀',
  handshake: '🤝',
  rocket: '🚀',
  wave: '👋',
  ok_hand: '👌',
  check: '✅',
  warning: '⚠️',
  coffee: '☕',
  pizza: '🍕',
  skull: '💀',
};

export interface Shortcode {
  name: string;
  emoji: string;
}

export interface TextEdit {
  text: string;
  caret: number;
}

const MAX_SUGGESTIONS = 6;

/** The ":smi" the caret is in the middle of (starts the text or follows whitespace), or null. */
export const findShortcode = (
  text: string,
  caret: number,
): { start: number; query: string } | null => {
  const match = /(^|\s):([a-z0-9_+]{2,24})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
};

/** Names that start with the query first, then names that only contain it. */
export const matchShortcodes = (query: string, limit = MAX_SUGGESTIONS): Shortcode[] => {
  const names = Object.keys(SHORTCODES);
  const starts = names.filter((n) => n.startsWith(query));
  const inside = names.filter((n) => !n.startsWith(query) && n.includes(query));
  return [...starts, ...inside].slice(0, limit).map((name) => ({
    name,
    emoji: SHORTCODES[name] ?? '',
  }));
};

/** Replace the half-typed ":smi" with the emoji and say where the caret goes. */
export const insertShortcode = (
  text: string,
  found: { start: number; query: string },
  emoji: string,
): TextEdit => {
  const end = found.start + 1 + found.query.length;
  return {
    text: text.slice(0, found.start) + emoji + text.slice(end),
    caret: found.start + emoji.length,
  };
};

/** A ":smile:" typed out in full (caret at its end) becomes the emoji. Null if it is not one. */
export const completeShortcode = (text: string, caret: number): TextEdit | null => {
  const before = text.slice(0, caret);
  const match = /(^|\s):([a-z0-9_+]{2,24}):$/.exec(before);
  const emoji = SHORTCODES[match?.[2] ?? ''];
  if (!match || !emoji) return null;
  const start = before.length - (match[2]?.length ?? 0) - 2;
  return { text: before.slice(0, start) + emoji + text.slice(caret), caret: start + emoji.length };
};

export const SHORTCODE_LIST_ID = 'shortcode-list';
export const shortcodeOptionId = (index: number): string => `shortcode-option-${String(index)}`;

type Field = HTMLInputElement | HTMLTextAreaElement;

export interface ShortcodeAutocomplete {
  items: Shortcode[];
  active: number;
  open: boolean;
  /** Call on every change of the text, with the caret position. */
  update: (text: string, caret: number) => void;
  /** Arrows, Enter, Tab and Escape while open; an object means "use this text", true "key used". */
  onKeyDown: (e: KeyboardEvent<Field>, text: string) => TextEdit | boolean;
  choose: (item: Shortcode, text: string) => TextEdit | null;
}

export const useShortcodeAutocomplete = (): ShortcodeAutocomplete => {
  const [found, setFound] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const items = found ? matchShortcodes(found.query) : [];
  const open = items.length > 0;

  const update = useCallback((text: string, caret: number) => {
    setFound(findShortcode(text, caret));
    setActive(0);
  }, []);

  const choose = (item: Shortcode, text: string): TextEdit | null => {
    if (!found) return null;
    const result = insertShortcode(text, found, item.emoji);
    setFound(null);
    return result;
  };

  const onKeyDown: ShortcodeAutocomplete['onKeyDown'] = (e, text) => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : items.length - 1;
      setActive((a) => (a + step) % items.length);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setFound(null);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const item = items[active];
      if (!item) return false;
      e.preventDefault();
      return choose(item, text) ?? true;
    }
    return false;
  };

  return { items, active, open, update, onKeyDown, choose };
};
