// Notification digest: with a digest on, non-urgent desktop notifications are held back and sent
// as one summary per chat every N hours. Urgent ones (mentions, keywords, urgent-looking text)
// still come straight through. Counts live in memory; this is a convenience, not a guarantee.
import { messageHint } from '../understand/heuristics';

const KEY = 'flick.digestHours';

export const DIGEST_CHOICES = [0, 1, 3, 6] as const;

export const getDigestHours = (): number => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
};

export const setDigestHours = (hours: number): void => {
  try {
    localStorage.setItem(KEY, String(hours));
  } catch {
    // private mode: the choice lasts until reload only
  }
  if (hours === 0) flushDigest();
};

interface Held {
  title: string;
  count: number;
  conversationId: string;
}
const held = new Map<string, Held>();
let timer: ReturnType<typeof setInterval> | null = null;
let lastFlush = Date.now();

/** One line per chat: "Maya: 3 new messages". */
export const digestLines = (items: Iterable<Held>): string[] =>
  [...items].map((h) => `${h.title}: ${h.count} new message${h.count === 1 ? '' : 's'}`);

export function flushDigest(): void {
  lastFlush = Date.now();
  if (held.size === 0) return;
  const lines = digestLines(held.values());
  held.clear();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification('Flick digest', {
    body: lines.join('\n'),
    tag: 'flick-digest',
    icon: '/icons/icon-192.png',
  });
}

/** True when the message was held for the digest (the caller then shows nothing now). */
export function holdForDigest(
  conversationId: string,
  title: string,
  text: string,
  urgent: boolean,
): boolean {
  if (getDigestHours() === 0 || urgent || messageHint(text)) return false;
  const h = held.get(conversationId);
  if (h) h.count += 1;
  else held.set(conversationId, { title, count: 1, conversationId });
  timer ??= setInterval(() => {
    const hours = getDigestHours();
    if (hours === 0 || Date.now() - lastFlush >= hours * 3_600_000) flushDigest();
  }, 60_000);
  return true;
}
