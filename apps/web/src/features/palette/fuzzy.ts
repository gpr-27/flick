/** Subsequence match score: 0 = no match, higher = better (earlier and tighter matches win). */
export const fuzzyScore = (query: string, text: string): number => {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  let pos = -1;
  let score = 0;
  for (const ch of q) {
    const next = t.indexOf(ch, pos + 1);
    if (next === -1) return 0;
    score += next === pos + 1 ? 3 : 1; // consecutive letters count more
    if (next === 0 || t[next - 1] === ' ') score += 2; // word starts
    pos = next;
  }
  return score + (t.startsWith(q) ? 10 : 0);
};

export const fuzzyFilter = <T extends { label: string }>(items: T[], query: string): T[] =>
  items
    .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
