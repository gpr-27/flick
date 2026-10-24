import type { UserSummary } from '@chat/contracts';

/** The header for names that do not start with a letter (digits, emoji, symbols). */
export const OTHER = '#';

export type DirectoryRow = { kind: 'header'; letter: string } | { kind: 'user'; user: UserSummary };

/** "élodie" -> "E", "ж" -> "Ж", "😀" -> "#". Accents are dropped so "Émile" sits under E. */
const firstChar = (text: string): string => {
  const code = text.codePointAt(0);
  return code === undefined ? '' : String.fromCodePoint(code);
};

export const letterOf = (name: string): string => {
  const first = firstChar(name.trim());
  const plain = first.normalize('NFD').replace(/\p{M}/gu, '').toLocaleUpperCase();
  const letter = firstChar(plain);
  return /^\p{L}$/u.test(letter) ? letter : OTHER;
};

// A to Z first, then other alphabets (Ж, 李), then "#" last.
const compareLetters = (a: string, b: string): number => {
  if (a === b) return 0;
  if (a === OTHER) return 1;
  if (b === OTHER) return -1;
  const aLatin = /^[A-Z]$/.test(a);
  const bLatin = /^[A-Z]$/.test(b);
  if (aLatin !== bLatin) return aLatin ? -1 : 1;
  return a.localeCompare(b);
};

/** Flat rows (a header, then its people, next header...) so a virtual list can render them. */
export const groupByLetter = (users: readonly UserSummary[]): DirectoryRow[] => {
  const groups = new Map<string, UserSummary[]>();
  for (const user of users) {
    const letter = letterOf(user.display_name);
    const list = groups.get(letter);
    if (list) list.push(user);
    else groups.set(letter, [user]);
  }
  const rows: DirectoryRow[] = [];
  for (const letter of [...groups.keys()].sort(compareLetters)) {
    rows.push({ kind: 'header', letter });
    for (const user of groups.get(letter) ?? []) rows.push({ kind: 'user', user });
  }
  return rows;
};
