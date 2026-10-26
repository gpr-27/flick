// Heuristic check for rude or spammy group messages. Pure, so it is easy to test.

const RUDE = /\b(idiot|stupid|shut up|moron|loser|dumb|hate you|kill yourself|wtf|stfu)\b/i;
const SPAM_WORDS =
  /\b(free money|click here|buy now|limited offer|giveaway|crypto|earn \$?\d+|dm me|whatsapp me|bit\.ly)\b/i;

/** Reasons a message looks rude or spammy; empty when it looks fine. */
export function flagReasons(text: string): string[] {
  const reasons: string[] = [];
  if (RUDE.test(text)) reasons.push('rude language');
  if (SPAM_WORDS.test(text)) reasons.push('spam words');
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.8) {
    reasons.push('all caps');
  }
  if ((text.match(/https?:\/\//gi) ?? []).length >= 3) reasons.push('many links');
  if (/(.)\1{9,}/.test(text)) reasons.push('repeated characters');
  return reasons;
}

/** Seconds a member still has to wait under slow mode (0 when free to send). */
export function slowModeWait(
  slowSeconds: number,
  lastSentMs: number | null,
  nowMs: number,
): number {
  if (slowSeconds <= 0 || lastSentMs === null) return 0;
  return Math.max(0, Math.ceil((lastSentMs + slowSeconds * 1000 - nowMs) / 1000));
}
