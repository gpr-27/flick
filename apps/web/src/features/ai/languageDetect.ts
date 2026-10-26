// A cheap guess at the language of a message, from its script and a few common words. No network.
// It only has to be right enough to offer a "Translate" chip; null means "not sure".

const SCRIPTS: [string, RegExp][] = [
  ['Telugu', /[ఀ-౿]/],
  ['Hindi', /[ऀ-ॿ]/],
  ['Tamil', /[஀-௿]/],
  ['Arabic', /[؀-ۿ]/],
  ['Russian', /[Ѐ-ӿ]/],
  ['Chinese', /[一-鿿]/],
  ['Japanese', /[぀-ヿ]/],
  ['Korean', /[가-힯]/],
];

const STOPWORDS: Record<string, string[]> = {
  English: ['the', 'and', 'is', 'you', 'to', 'of', 'it', 'that', 'for', 'are'],
  Spanish: ['el', 'la', 'que', 'de', 'y', 'es', 'en', 'los', 'por', 'una'],
  French: ['le', 'la', 'les', 'est', 'et', 'des', 'une', 'pas', 'vous', 'je'],
  German: ['der', 'die', 'und', 'ist', 'das', 'nicht', 'ich', 'ein', 'zu', 'mit'],
};

export function detectLanguage(text: string): string | null {
  for (const [name, pattern] of SCRIPTS) if (pattern.test(text)) return name;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 4) return null;
  let best: [string, number] = ['', 0];
  for (const [name, list] of Object.entries(STOPWORDS)) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits > best[1]) best = [name, hits];
  }
  return best[1] >= 2 ? best[0] : null;
}

/** The language of the app's own UI. */
export const UI_LANGUAGE = 'English';

/** The detected language when it clearly differs from the UI language, else null. */
export const foreignLanguage = (text: string, ui = UI_LANGUAGE): string | null => {
  const found = detectLanguage(text);
  return found && found !== ui ? found : null;
};
