import { UI_LANGUAGE } from '@/features/ai/languageDetect';

/**
 * The language "Translate" uses when nobody picked one: the chat's auto-translate language, else
 * the app language, else (for a note already in the app language, where translating would change
 * nothing) the last language used or Spanish.
 */
export const defaultTarget = (
  chatLanguage: string | null,
  source: string | null,
  remembered: string | null,
): string => {
  if (chatLanguage) return chatLanguage;
  if (remembered && remembered !== source) return remembered;
  return source === UI_LANGUAGE ? 'Spanish' : UI_LANGUAGE;
};
