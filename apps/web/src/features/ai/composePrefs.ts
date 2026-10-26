import type { AI_COMPOSE_TONES, AiComposeRequest } from '@chat/contracts';

// Per-device choices for "Describe your message": the last prompts and the tone/length settings.

const PROMPTS_KEY = 'flick.compose.prompts';
const PREFS_KEY = 'flick.compose.prefs';
export const MAX_RECENT_PROMPTS = 5;

type Tone = (typeof AI_COMPOSE_TONES)[number];
export type Length = 'shorter' | 'default' | 'longer';

/** Tones the settings popover offers (shorter/longer are lengths). */
export const SETTINGS_TONES = ['casual', 'formal', 'friendly'] as const satisfies readonly Tone[];

export interface ComposePrefs {
  tone: (typeof SETTINGS_TONES)[number] | null;
  length: Length;
}

export const DEFAULT_PREFS: ComposePrefs = { tone: null, length: 'default' };

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: the choice is just not remembered
  }
};

/** `prompt` first, without a copy of itself further down, at most five. */
export const addRecentPrompt = (list: readonly string[], prompt: string): string[] => {
  const clean = prompt.trim();
  if (!clean) return [...list];
  const key = clean.toLowerCase();
  return [clean, ...list.filter((p) => p.toLowerCase() !== key)].slice(0, MAX_RECENT_PROMPTS);
};

export const readRecentPrompts = (): string[] => {
  const raw = read(PROMPTS_KEY);
  return Array.isArray(raw)
    ? raw
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .slice(0, MAX_RECENT_PROMPTS)
    : [];
};

export const saveRecentPrompt = (prompt: string): string[] => {
  const next = addRecentPrompt(readRecentPrompts(), prompt);
  write(PROMPTS_KEY, next);
  return next;
};

export const readPrefs = (): ComposePrefs => {
  const raw = read(PREFS_KEY);
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS;
  const { tone, length } = raw as Record<string, unknown>;
  return {
    tone: SETTINGS_TONES.find((t) => t === tone) ?? null,
    length: length === 'shorter' || length === 'longer' ? length : 'default',
  };
};

export const savePrefs = (prefs: ComposePrefs): void => {
  write(PREFS_KEY, prefs);
};

/** The `tone` and `length` fields a write or reply request carries for these settings. */
export const prefsFields = (
  prefs: ComposePrefs,
): Pick<Extract<AiComposeRequest, { mode: 'write' }>, 'tone' | 'length'> => ({
  ...(prefs.tone ? { tone: prefs.tone } : {}),
  ...(prefs.length !== 'default' ? { length: prefs.length } : {}),
});
