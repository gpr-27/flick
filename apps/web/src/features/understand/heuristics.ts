// Cheap local checks. Nothing here calls the model; the AI is only asked when the person taps.
import type { ConversationSummary } from '@chat/contracts';

export type Hint = 'urgent' | 'upset';

const URGENT = /\b(urgent|urgently|asap|immediately|emergency|right now|hurry|call me now)\b/i;
const UPSET =
  /\b(angry|furious|disappointed|upset|sick of|fed up|how could you|unacceptable|wtf|ridiculous|i hate)\b/i;

/** "urgent" or "upset" when the text looks like it, else null. */
export function messageHint(text: string): Hint | null {
  const t = text.trim();
  if (t.length < 3) return null;
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = t.replace(/[^\p{Lu}]/gu, '');
  const shouting = letters.length >= 8 && upper.length / letters.length > 0.7;
  if (URGENT.test(t) || /!{3,}/.test(t)) return 'urgent';
  if (UPSET.test(t) || shouting) return 'upset';
  return null;
}

export const NEEDS_REPLY_AFTER_MS = 2 * 60 * 60 * 1000;

/** The last message is from the other person and has been waiting for more than 2 hours. */
export function needsReply(
  c: ConversationSummary,
  myId: string | undefined,
  now: number = Date.now(),
): boolean {
  const last = c.last_message;
  if (!last || !myId || c.is_saved || c.prefs.archived) return false;
  if (!last.sender_user_id || last.sender_user_id === myId) return false;
  return now - Date.parse(last.created_at) > NEEDS_REPLY_AFTER_MS;
}

/** Link or a number/claim-like text: worth a "Check this" button. */
export const looksCheckable = (text: string): boolean =>
  /https?:\/\//i.test(text) || (text.length > 40 && /\d/.test(text));
