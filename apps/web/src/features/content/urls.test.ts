import { describe, expect, it } from 'vitest';
import { splitLinks } from './urls';

describe('splitLinks', () => {
  it('cuts a text into plain parts and links, leaving trailing punctuation outside', () => {
    expect(splitLinks('see https://a.dev/x, ok')).toEqual([
      { text: 'see ' },
      { text: 'https://a.dev/x', href: 'https://a.dev/x' },
      { text: ', ok' },
    ]);
  });

  it('returns one plain part when there is no link, and never makes javascript: links', () => {
    expect(splitLinks('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });
});
