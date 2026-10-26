// Follow-up nudges: spot "I will send the report by Tuesday" in the person's own messages.
// A plain pattern match (no AI): a promise phrase, optionally followed by a time word.

const PROMISE =
  /\b(i(?:'ll| will| am going to|'m going to| can)|let me|i promise to|will do|i'?ll get back to you)\b/i;
const TIME_WORD =
  /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|end of (?:the )?(?:day|week))\b/i;
// Short acknowledgements are not promises ("I will, thanks").
const MIN_LENGTH = 15;

export interface Detected {
  whenHint: string | null;
}

/** null when the text is not a promise. */
export function detectPromise(text: string): Detected | null {
  const t = text.trim();
  if (t.length < MIN_LENGTH || t.endsWith('?')) return null;
  if (!PROMISE.test(t)) return null;
  const time = TIME_WORD.exec(t);
  return { whenHint: time ? time[1]!.toLowerCase() : null };
}
