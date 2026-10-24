// @mentions: autocomplete while typing, and highlighting in bubbles.
//
// A mention is written as plain "@username" in the text. The message also carries the mentioned
// user ids (content.mentions) so the server can bypass mute for them.
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { ENDPOINTS, type UserSummary } from '@chat/contracts';
import { getApi } from '@/lib/services';

// ── pure helpers ───────────────────────────────────────────────────────────

/** The "@par" the caret is in the middle of, or null. A mention starts at the start or after a space. */
export const findMention = (
  text: string,
  caret: number,
): { start: number; query: string } | null => {
  const match = /(^|\s)@([a-zA-Z0-9_.]{0,32})$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: caret - query.length - 1, query };
};

/** Replace the half-typed mention with "@username " and say where the caret goes. */
export const insertMention = (
  text: string,
  mention: { start: number; query: string },
  username: string,
): { text: string; caret: number } => {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${username} `;
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(end),
    caret: mention.start + inserted.length,
  };
};

export interface TextPart {
  text: string;
  mention: boolean;
}

/** Splits text so that "@username" of a known user (or the bot) can be drawn highlighted. */
export const splitMentions = (text: string, known: ReadonlySet<string>): TextPart[] => {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/(^|\s)@([a-zA-Z0-9_.]{3,32})/g)) {
    const lead = m[1] ?? '';
    const name = m[2] ?? '';
    if (!known.has(name.toLowerCase())) continue;
    const start = m.index + lead.length;
    if (start > last) parts.push({ text: text.slice(last, start), mention: false });
    parts.push({ text: `@${name}`, mention: true });
    last = start + name.length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mention: false });
  return parts;
};

// ── autocomplete in the composer ───────────────────────────────────────────

export interface MentionAutocomplete {
  items: UserSummary[];
  active: number;
  open: boolean;
  /** Call on every change of the text, with the caret position. */
  update: (text: string, caret: number) => void;
  /** Handles arrows, Enter, Tab and Escape while the list is open; true if the key was used. */
  onKeyDown: (
    e: KeyboardEvent<HTMLInputElement>,
    text: string,
  ) => { text: string; caret: number } | boolean;
  choose: (user: UserSummary, text: string) => { text: string; caret: number } | null;
  /** The ids of the users whose "@username" is still in the text. */
  idsIn: (text: string) => string[];
}

export const useMentionAutocomplete = (conversationId: string): MentionAutocomplete => {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [items, setItems] = useState<UserSummary[]>([]);
  const [active, setActive] = useState(0);
  const chosen = useRef(new Map<string, UserSummary>());
  const latest = useRef(0);

  const close = useCallback(() => {
    latest.current += 1; // drops an answer that is still on its way
    setMention(null);
    setItems([]);
  }, []);

  const update = useCallback(
    (text: string, caret: number) => {
      const found = findMention(text, caret);
      if (!found) {
        close();
        return;
      }
      setMention(found);
      setActive(0);
      const ticket = ++latest.current;
      getApi()
        .call(ENDPOINTS.conversations.mentionCandidates, {
          params: { conversation_id: conversationId },
          query: { q: found.query, limit: 8 },
        })
        .then((res) => {
          if (ticket === latest.current) setItems(res.items);
        })
        .catch(() => {
          if (ticket === latest.current) setItems([]);
        });
    },
    [conversationId, close],
  );

  const choose = useCallback(
    (user: UserSummary, text: string) => {
      if (!mention) return null;
      chosen.current.set(user.username, user);
      const result = insertMention(text, mention, user.username);
      close();
      return result;
    },
    [mention, close],
  );

  const open = mention !== null && items.length > 0;

  const onKeyDown: MentionAutocomplete['onKeyDown'] = (e, text) => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const user = items[active];
      if (!user) return false;
      e.preventDefault();
      return choose(user, text) ?? true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return true;
    }
    return false;
  };

  const idsIn = useCallback(
    (text: string) =>
      [...chosen.current.values()]
        .filter((u) => text.toLowerCase().includes(`@${u.username}`))
        .map((u) => u.id),
    [],
  );

  return { items, active, open, update, onKeyDown, choose, idsIn };
};

export const MENTION_LIST_ID = 'mention-list';
export const mentionOptionId = (index: number): string => `mention-option-${index}`;
