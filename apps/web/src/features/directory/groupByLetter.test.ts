import { describe, expect, it } from 'vitest';
import type { UserSummary } from '@chat/contracts';
import { groupByLetter, letterOf } from './groupByLetter';

const person = (display_name: string): UserSummary => ({
  id: display_name,
  username: display_name,
  display_name,
  avatar_url: null,
  is_bot: false,
});

describe('letterOf', () => {
  it('uses the upper-case first letter, so lower case is the same as upper case', () => {
    expect(letterOf('alice')).toBe('A');
    expect(letterOf('Alice')).toBe('A');
    expect(letterOf('  bob')).toBe('B');
  });

  it('drops accents', () => {
    expect(letterOf('Émile')).toBe('E');
    expect(letterOf('ångström')).toBe('A');
  });

  it('keeps letters of other alphabets', () => {
    expect(letterOf('Борис')).toBe('Б');
    expect(letterOf('ж')).toBe('Ж');
    expect(letterOf('李雷')).toBe('李');
  });

  it('puts emoji, digits, symbols and empty names under #', () => {
    expect(letterOf('😀 happy')).toBe('#');
    expect(letterOf('42nd')).toBe('#');
    expect(letterOf('_x')).toBe('#');
    expect(letterOf('')).toBe('#');
  });
});

describe('groupByLetter', () => {
  it('puts a header before each letter group, A to Z, other alphabets next, # last', () => {
    const rows = groupByLetter(
      ['😀 smile', 'Борис', 'bob', 'Anna', 'élan', 'zed', '7up'].map(person),
    );
    const headers = rows.flatMap((r) => (r.kind === 'header' ? [r.letter] : []));
    expect(headers).toEqual(['A', 'B', 'E', 'Z', 'Б', '#']);
  });

  it('keeps the server order inside a group', () => {
    const rows = groupByLetter(['Ann', 'amy', 'Abe'].map(person));
    expect(rows.map((r) => (r.kind === 'header' ? r.letter : r.user.display_name))).toEqual([
      'A',
      'Ann',
      'amy',
      'Abe',
    ]);
  });

  it('is empty for nobody', () => {
    expect(groupByLetter([])).toEqual([]);
  });
});
