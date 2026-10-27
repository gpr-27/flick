import { describe, expect, it } from 'vitest';
import { hasMarkdown, stripMarkdown } from './stripMarkdown';

describe('stripMarkdown', () => {
  it('drops bold, italic, strike, code and link syntax but keeps the words', () => {
    expect(stripMarkdown('**Bold** and *it* and ~~no~~ and `code`')).toBe(
      'Bold and it and no and code',
    );
    expect(stripMarkdown('see [the docs](https://x.test/a) now')).toBe('see the docs now');
  });

  it('makes lists, headings, quotes and tables one line', () => {
    expect(stripMarkdown('# Title\n- **One:** a\n- Two\n1) Three\n> quote')).toBe(
      'Title One: a Two Three quote',
    );
    expect(stripMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('a · b 1 · 2');
    expect(stripMarkdown('```js\nlet x = 1;\n```')).toBe('let x = 1;');
  });

  it('leaves ordinary text alone', () => {
    expect(stripMarkdown('2 * 3 * 4 = 24, snake_case_name, a | b')).toBe(
      '2 * 3 * 4 = 24, snake_case_name, a | b',
    );
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown('నమస్కారం **స్నేహితుడా**')).toBe('నమస్కారం స్నేహితుడా');
  });

  it('strips the exact explain text', () => {
    const out = stripMarkdown(
      '**Description:** A close-up.\n\n**Visible text:** None.\n\n**Notable details:**\n- **Background, left:** A sheer curtain.',
    );
    expect(out).toBe(
      'Description: A close-up. Visible text: None. Notable details: Background, left: A sheer curtain.',
    );
  });
});

describe('hasMarkdown', () => {
  it('spots markdown and ignores plain text', () => {
    expect(hasMarkdown('hello **x**')).toBe(true);
    expect(hasMarkdown('- item')).toBe(true);
    expect(hasMarkdown('just words, 3 * 4')).toBe(false);
  });
});
