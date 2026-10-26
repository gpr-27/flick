// Does a stranger's display name copy someone you already chat with? Pure.

const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
};

/** Lower-case, no accents or spaces/punctuation, digits and symbols mapped to the letters they imitate. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134-7@$!]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/[^\p{L}]/gu, '');
}

export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const at = (k: number): number => prev[k] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    let diag = at(0);
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(at(j) + 1, at(j - 1) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = at(j);
      prev[j] = next;
    }
  }
  return at(b.length);
}

/** The known name this one copies (same after lookalike clean-up, or one typo away), else null. */
export function findImpersonated(name: string, knownNames: readonly string[]): string | null {
  const mine = normalizeName(name);
  if (mine.length < 4) return null;
  for (const known of knownNames) {
    if (known === name) continue;
    const theirs = normalizeName(known);
    if (theirs.length < 4) continue;
    if (mine === theirs) return known;
    if (Math.min(mine.length, theirs.length) >= 6 && editDistance(mine, theirs) === 1) return known;
  }
  return null;
}
