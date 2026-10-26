/** Translations already fetched, per message, so showing one again costs nothing. */
export const translationCache = new Map<string, string>();

export const clearTranslationCache = (): void => {
  translationCache.clear();
};
