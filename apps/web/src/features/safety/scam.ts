// A quick score for "does this first message look like a scam or spam?". Pure heuristics.
import { assessLink } from './linkSafety';

export interface ScamResult {
  score: number;
  reasons: string[];
}

const SIGNALS: [RegExp, number, string][] = [
  [/\b(urgent|immediately|act now|within 24 hours|last chance)\b/i, 1, 'pushes you to hurry'],
  [
    /\b(gift ?card|crypto|bitcoin|usdt|wire transfer|western union|investment|guaranteed (profit|returns?))\b/i,
    2,
    'talks about money or crypto',
  ],
  [
    /\b(you (have )?won|winner|lottery|prize|claim your|free (iphone|money|gift))\b/i,
    3,
    'promises a prize',
  ],
  [
    /\b(verify|confirm|update) your (account|password|bank|identity|details)\b/i,
    2,
    'asks you to verify your account',
  ],
  [
    /\b(otp|one[- ]time (code|password)|verification code|pin number|cvv|seed phrase)\b/i,
    3,
    'asks for a secret code',
  ],
  [/\b(send me|dm me|whatsapp me|telegram)\b/i, 1, 'tries to move you to another app'],
  [/\b(work from home|easy money|earn \$?\d+|part[- ]time job)\b/i, 2, 'offers easy money'],
  [/\b(dear (customer|friend|sir|madam|user))\b/i, 1, 'uses a generic greeting'],
];

export function scamScore(text: string): ScamResult {
  let score = 0;
  const reasons: string[] = [];
  for (const [re, points, why] of SIGNALS) {
    if (re.test(text)) {
      score += points;
      reasons.push(why);
    }
  }
  for (const m of text.match(/https?:\/\/\S+/gi) ?? []) {
    const link = assessLink(m);
    if (link.level !== 'ok') {
      score += link.level === 'danger' ? 3 : 1;
      reasons.push('contains a suspicious link');
      break;
    }
  }
  return { score, reasons: [...new Set(reasons)] };
}

export const SCAM_THRESHOLD = 3;
export const looksLikeScam = (text: string): boolean => scamScore(text).score >= SCAM_THRESHOLD;
