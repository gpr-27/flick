/** The words to add after `text`, with a space when a new word starts. */
export const joinSuggestion = (text: string, suggestion: string): string => {
  const s = suggestion.replace(/\s+$/, '');
  if (!s) return '';
  return /\s$/.test(text) || /^[\s,.;:!?)]/.test(s) ? s : ` ${s}`;
};

/** Words that differ between two texts: how many "issues" a grammar fix changes. */
export const countChanges = (before: string, after: string): number => {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const rest = new Map<string, number>();
  for (const w of a) rest.set(w, (rest.get(w) ?? 0) + 1);
  let added = 0;
  for (const w of b) {
    const n = rest.get(w) ?? 0;
    if (n > 0) rest.set(w, n - 1);
    else added++;
  }
  return Math.max(added, a.length - (b.length - added));
};
