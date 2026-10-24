import { describe, expect, it } from 'vitest';
import { LIMITS } from '@chat/contracts';
import { cleanOutgoing, counterState, dragHasFiles, expandSlashCommand } from './composerTools';
import { applyFormat, shortcutKind, TABLE_TEMPLATE } from './markdownFormat';
import { rowsFromHtml, rowsFromTsv, tableFromClipboard, toMarkdownTable } from './pasteTable';
import {
  completeShortcode,
  findShortcode,
  insertShortcode,
  matchShortcodes,
  SHORTCODES,
} from './shortcodes';

describe('counterState', () => {
  const max = LIMITS.MAX_TEXT_LENGTH;
  it('stays hidden far from the limit', () => {
    expect(counterState(10)).toBeNull();
  });
  it('shows what is left near the limit', () => {
    expect(counterState(max - 5)).toEqual({ left: 5, over: false });
  });
  it('says over when past the limit', () => {
    expect(counterState(max + 3)).toEqual({ left: -3, over: true });
  });
});

describe('cleanOutgoing', () => {
  it('keeps newlines, indentation and tabs inside the text', () => {
    expect(cleanOutgoing('a\n\n    b\n\tc')).toBe('a\n\n    b\n\tc');
  });
  it('drops blank lines at the start and blank space at the end', () => {
    expect(cleanOutgoing('\n\n  \n  indented\nline\n\n  ')).toBe('  indented\nline');
  });
});

describe('expandSlashCommand', () => {
  it('turns /flick into @flick', () => {
    expect(expandSlashCommand('/flick')).toEqual({ text: '@flick ', caret: 7 });
    expect(expandSlashCommand('/flick ')).toEqual({ text: '@flick ', caret: 7 });
  });
  it('leaves other text alone', () => {
    expect(expandSlashCommand('/fli')).toBeNull();
    expect(expandSlashCommand('hi /flick')).toBeNull();
  });
});

describe('dragHasFiles', () => {
  it('is true only for file drags', () => {
    expect(dragHasFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true);
    expect(dragHasFiles({ types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});

describe('shortcodes', () => {
  it('finds the half-typed code at the caret', () => {
    expect(findShortcode('hi :smi', 7)).toEqual({ start: 3, query: 'smi' });
    expect(findShortcode('http://x', 8)).toBeNull();
    expect(findShortcode(':s', 2)).toBeNull();
  });
  it('lists names starting with the query first', () => {
    const names = matchShortcodes('smile').map((m) => m.name);
    expect(names[0]).toBe('smile');
    expect(matchShortcodes('zzzz')).toEqual([]);
  });
  it('inserts the emoji and puts the caret after it', () => {
    const found = { start: 3, query: 'smi' };
    expect(insertShortcode('hi :smi', found, '😄')).toEqual({ text: 'hi 😄', caret: 5 });
  });
  it('completes a full :name: and ignores unknown names', () => {
    expect(completeShortcode('ok :fire:', 9)).toEqual({ text: `ok ${SHORTCODES.fire}`, caret: 5 });
    expect(completeShortcode('ok :nope_x:', 11)).toBeNull();
  });
});

describe('pasted tables', () => {
  it('converts tab-separated rows', () => {
    expect(tableFromClipboard({ getData: (t) => (t === 'text/plain' ? 'a\tb\n1\t2\n' : '') })).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
    );
  });
  it('converts an HTML table, preferring it over the plain text', () => {
    const html = '<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Pen</td><td>3</td></tr></table>';
    expect(tableFromClipboard({ getData: (t) => (t === 'text/html' ? html : 'x') })).toBe(
      '| Name | Qty |\n| --- | --- |\n| Pen | 3 |',
    );
  });
  it('pads ragged rows to the widest row', () => {
    expect(toMarkdownTable([['a', 'b', 'c'], ['1']])).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |',
    );
    expect(rowsFromTsv('a\tb\tc\nd\te')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
  });
  it('escapes pipes and flattens new lines inside cells', () => {
    expect(
      toMarkdownTable([
        ['x|y', 'z'],
        ['a\nb', 'c'],
      ]),
    ).toBe('| x\\|y | z |\n| --- | --- |\n| a b | c |');
  });
  it('does not treat tab-indented code or a single line as a table', () => {
    expect(rowsFromTsv('function f() {\n\treturn 1;\n}')).toBeNull();
    expect(rowsFromTsv('\tindented\n\talso')).toBeNull();
    expect(rowsFromTsv('a\tb')).toBeNull();
    expect(rowsFromHtml('<p>no table</p>')).toBeNull();
    expect(tableFromClipboard({ getData: () => 'just words' })).toBeNull();
  });
});

describe('applyFormat', () => {
  it('wraps the selection', () => {
    const r = applyFormat('bold', 'say hi now', 4, 6);
    expect(r).toEqual({ text: 'say **hi** now', start: 6, end: 8 });
    expect(applyFormat('italic', 'a', 0, 1).text).toBe('_a_');
    expect(applyFormat('strike', 'a', 0, 1).text).toBe('~~a~~');
    expect(applyFormat('code', 'a', 0, 1).text).toBe('`a`');
  });
  it('puts the caret between empty markers', () => {
    expect(applyFormat('bold', 'ab', 1, 1)).toEqual({ text: 'a****b', start: 3, end: 3 });
  });
  it('makes a code block on its own lines', () => {
    expect(applyFormat('codeblock', 'x = 1', 0, 5).text).toBe('```\nx = 1\n```');
    expect(applyFormat('codeblock', 'see x', 4, 5).text).toBe('see \n```\nx\n```');
  });
  it('prefixes every selected line for lists, quotes and headings', () => {
    expect(applyFormat('bullet', 'a\nb\nc', 0, 3).text).toBe('- a\n- b\nc');
    expect(applyFormat('numbered', 'a\nb', 0, 3).text).toBe('1. a\n2. b');
    expect(applyFormat('quote', 'one\ntwo', 5, 5).text).toBe('one\n> two');
    expect(applyFormat('heading', 'Title', 2, 2).text).toBe('## Title');
  });
  it('makes a link and selects the address', () => {
    const r = applyFormat('link', 'go here', 3, 7);
    expect(r.text).toBe('go [here](https://)');
    expect(r.text.slice(r.start, r.end)).toBe('https://');
  });
  it('inserts a 3 column table', () => {
    expect(applyFormat('table', '', 0, 0).text).toBe(TABLE_TEMPLATE);
    expect(applyFormat('table', 'hi', 2, 2).text).toBe(`hi\n${TABLE_TEMPLATE}`);
  });
});

describe('shortcutKind', () => {
  const key = (k: string, extra = {}) => ({
    key: k,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });
  it('maps Ctrl/Cmd+B, I and E', () => {
    expect(shortcutKind(key('b'))).toBe('bold');
    expect(shortcutKind(key('I'))).toBe('italic');
    expect(shortcutKind(key('e', { ctrlKey: false, metaKey: true }))).toBe('code');
  });
  it('ignores other keys and plain typing', () => {
    expect(shortcutKind(key('x'))).toBeNull();
    expect(shortcutKind(key('b', { ctrlKey: false }))).toBeNull();
    expect(shortcutKind(key('b', { shiftKey: true }))).toBeNull();
  });
});
