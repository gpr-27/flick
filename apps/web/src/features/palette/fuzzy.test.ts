import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzy', () => {
  it('needs every letter in order', () => {
    expect(fuzzyScore('stg', 'Settings')).toBeGreaterThan(0);
    expect(fuzzyScore('gts', 'Settings')).toBe(0);
  });
  it('ranks prefixes first and keeps all on an empty query', () => {
    const items = [{ label: 'My calendar' }, { label: 'Calendar' }];
    expect(fuzzyFilter(items, 'cal')[0]!.label).toBe('Calendar');
    expect(fuzzyFilter(items, '')).toHaveLength(2);
  });
});
