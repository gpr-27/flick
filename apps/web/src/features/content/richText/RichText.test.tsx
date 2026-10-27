import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RichText } from './RichText';
import { parseBlocks, splitRow } from './parse';
import { safeHref } from './safeHref';

const view = (text: string) => render(<RichText text={text} />).container;

describe('plain text', () => {
  it('is one pre-wrap paragraph with its line breaks, as before', () => {
    const c = view('hello\n\nworld\nsecond line');
    const p = c.querySelector('p');
    expect(c.querySelectorAll('p')).toHaveLength(1);
    expect(p).toHaveClass('whitespace-pre-wrap');
    expect(p?.textContent).toBe('hello\n\nworld\nsecond line');
  });

  it('does not treat a lone pipe or dash line as markdown', () => {
    expect(view('a | b').querySelector('table')).toBeNull();
    expect(view('2 * 3 * 4').querySelector('em')).toBeNull();
  });
});

describe('inline', () => {
  it('renders bold, italic, strike and inline code', () => {
    const c = view('**b** *i* ~~s~~ `c`');
    expect(c.querySelector('strong')?.textContent).toBe('b');
    expect(c.querySelector('em')?.textContent).toBe('i');
    expect(c.querySelector('del')?.textContent).toBe('s');
    expect(c.querySelector('code')?.textContent).toBe('c');
  });

  it('nests italic in bold and lets a backslash escape a marker', () => {
    const c = view('**bold *and italic***');
    expect(c.querySelector('strong em')?.textContent).toBe('and italic');
    expect(view('\\*not italic\\*').querySelector('em')).toBeNull();
  });

  it('autolinks bare URLs without the closing punctuation', () => {
    const c = view('see https://example.com/a?b=1.');
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('href', 'https://example.com/a?b=1');
    expect(c.textContent).toBe('see https://example.com/a?b=1.');
  });

  it('opens links safely', () => {
    view('[docs](https://example.com) and [mail](mailto:a@b.co)');
    for (const a of screen.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    }
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:a@b.co');
  });

  it('can draw the plain parts itself (mentions)', () => {
    render(<RichText text="hi @bob **there**" renderText={(s) => <span data-p>{s}</span>} />);
    expect(screen.getAllByText(/hi @bob/)[0]).toHaveAttribute('data-p');
  });
});

describe('blocks', () => {
  it('renders headings 1 to 6 in shrinking sizes', () => {
    const c = view('# a\n## b\n### c\n#### d\n##### e\n###### f');
    const sizes = ['text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm', 'text-xs'];
    sizes.forEach((size, i) => {
      const h = c.querySelector(`h${i + 1}`);
      expect(h).toHaveClass(size);
    });
  });

  it('renders ordered, bullet and nested lists', () => {
    const c = view('1. one\n2. two\n   - nested a\n   - nested b\n3. three');
    const ol = c.querySelector('ol');
    expect(ol?.children).toHaveLength(3);
    expect(ol?.querySelectorAll(':scope > li:nth-child(2) ul > li')).toHaveLength(2);
    expect(view('- a\n- b').querySelectorAll('ul > li')).toHaveLength(2);
  });

  it('keeps the start number of an ordered list', () => {
    expect(view('3. c\n4. d').querySelector('ol')).toHaveAttribute('start', '3');
  });

  it('renders task lists with disabled checkboxes', () => {
    view('- [x] done\n- [ ] todo');
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[0]).toBeDisabled();
  });

  it('renders block quotes (nested) and rules', () => {
    const c = view('> quoted\n> > deeper\n\n---\n\n***');
    expect(c.querySelector('blockquote blockquote')?.textContent).toBe('deeper');
    expect(c.querySelectorAll('hr')).toHaveLength(2);
  });

  it('renders fenced code with a language label and a copy button for the raw code', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const c = view('```ts\nconst a = 1 < 2;\n  const b = "**x**";\n```');
    expect(screen.getByText('ts')).toBeInTheDocument();
    expect(c.querySelector('pre')).toHaveClass('overflow-x-auto');
    expect(c.querySelector('pre code')?.textContent).toBe('const a = 1 < 2;\n  const b = "**x**";');
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(write).toHaveBeenCalledWith('const a = 1 < 2;\n  const b = "**x**";');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('runs an unclosed fence to the end', () => {
    expect(view('```\nabc\ndef').querySelector('pre code')?.textContent).toBe('abc\ndef');
  });

  it('stops very deep nesting from recursing forever', () => {
    const c = view(`${'> '.repeat(200)}deep`);
    expect(c.textContent).toContain('deep');
  });
});

describe('tables', () => {
  const TABLE =
    '| Name | Qty | Price |\n|:-----|:---:|------:|\n| Apple | 3 | $1 |\n| Pear | 12 | $22 |';

  it('renders a real table with header, cells and alignment', () => {
    view(TABLE);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Qty', 'Price']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const cells = within(rows[2] as HTMLElement).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['Pear', '12', '$22']);
    expect(cells[0]).toHaveClass('text-left');
    expect(cells[1]).toHaveClass('text-center');
    expect(cells[2]).toHaveClass('text-right');
  });

  it('scrolls inside its own wrapper instead of squashing', () => {
    const c = view(TABLE);
    expect(c.querySelector('table')?.parentElement).toHaveClass('overflow-x-auto');
    expect(c.querySelector('table')).toHaveClass('w-max');
  });

  it('formats inline markdown in cells and keeps an escaped pipe', () => {
    view('| a | b |\n|---|---|\n| **bold** | x \\| y |');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByRole('cell', { name: 'x | y' })).toBeInTheDocument();
  });

  it('pads short rows and cuts long ones', () => {
    view('| a | b |\n|---|---|\n| only |\n| 1 | 2 | 3 |');
    const rows = screen.getAllByRole('row');
    expect(within(rows[1] as HTMLElement).getAllByRole('cell')).toHaveLength(2);
    expect(within(rows[2] as HTMLElement).getAllByRole('cell')).toHaveLength(2);
  });

  it('is not a table when the delimiter row is missing or does not match', () => {
    expect(view('| a | b |\n| c | d |').querySelector('table')).toBeNull();
    expect(view('| a | b |\n|---|').querySelector('table')).toBeNull();
    expect(view('| a | b |\n|-x-|---|').querySelector('table')).toBeNull();
  });

  it('handles tables with no outer pipes and a table inside a list', () => {
    expect(view('a | b\n--- | ---\n1 | 2').querySelector('table')).not.toBeNull();
    expect(
      view('- item\n  | a | b |\n  |---|---|\n  | 1 | 2 |').querySelector('li table'),
    ).not.toBeNull();
  });

  it('renders a very long table without trouble', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `| ${i} | row ${i} |`).join('\n');
    const c = view(`| n | label |\n|---|---|\n${rows}`);
    expect(c.querySelectorAll('tbody tr')).toHaveLength(1000);
  }, 30_000);

  it('splits rows on pipes only', () => {
    expect(splitRow('| a | b\\|c | d |')).toEqual(['a', 'b|c', 'd']);
  });
});

describe('safety', () => {
  it('never creates a script, image or event handler from a message', () => {
    const c = view(
      '<script>alert(1)</script> <img src=x onerror=alert(1)> <b onclick="x()">hi</b>\n\n# <script>x</script>',
    );
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('b')).toBeNull();
    expect(c.querySelector('[onerror],[onclick]')).toBeNull();
    expect(c.textContent).toContain('<script>alert(1)</script>');
  });

  it('shows javascript:, data: and vbscript: links as text, not links', () => {
    const c = view(
      '[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](data:text/html;base64,AAAA) [d](vbscript:x)',
    );
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('[a](javascript:alert(1)');
  });

  it('keeps hostile text in table cells and code as text', () => {
    const c = view(
      '| <img src=x onerror=1> |\n|---|\n| <script>1</script> |\n\n```\n<script>2</script>\n```',
    );
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(screen.getByRole('cell').textContent).toBe('<script>1</script>');
  });

  it('only allows http, https and mailto', () => {
    expect(safeHref('https://a.co')).toBe('https://a.co/');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' javascript:alert(1)')).toBeNull();
    expect(safeHref('ftp://a.co')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
  });
});

describe('right-to-left text', () => {
  it('lets the browser pick the direction per block and cell', () => {
    const c = view('# مرحبا\n\nمرحبا بالعالم\n\n| أ | ب |\n|---|---|\n| ١ | ٢ |');
    expect(c.querySelector('h1')).toHaveAttribute('dir', 'auto');
    expect(c.querySelector('p')).toHaveAttribute('dir', 'auto');
    expect(c.querySelector('td')).toHaveAttribute('dir', 'auto');
    expect(view('שלום עולם').querySelector('p')).toHaveAttribute('dir', 'auto');
  });
});

describe('parser', () => {
  it('turns a mixed message into the expected block kinds', () => {
    const kinds = parseBlocks('# t\n\ntext\n\n- a\n\n> q\n\n---\n\n```\nc\n```').map((b) => b.kind);
    expect(kinds).toEqual(['heading', 'para', 'list', 'quote', 'hr', 'code']);
  });

  it('lets a bullet interrupt a paragraph', () => {
    expect(parseBlocks('intro\n- a\n- b').map((b) => b.kind)).toEqual(['para', 'list']);
  });
});

describe('model answers (Explain with Flick)', () => {
  const TEXT =
    '**Description:** A close-up of a person.\n\n**Visible text:** None.\n\n**Notable details:**\n- **Background, left:** A sheer curtain, softly lit.\n- **Glasses:** Round frames.';

  it('parses bold lines and bold-led bullets with single newlines as a list', () => {
    const blocks = parseBlocks(TEXT);
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'para', 'para', 'list']);
    const list = blocks[3];
    expect(list?.kind === 'list' && list.items).toHaveLength(2);
  });

  it('draws strong labels and list items without any asterisks', () => {
    const c = view(TEXT);
    expect(c.textContent).not.toContain('**');
    expect(c.querySelectorAll('li')).toHaveLength(2);
    expect(c.querySelector('li strong')?.textContent).toBe('Background, left:');
    expect(c.querySelectorAll('strong')).toHaveLength(5);
  });

  it('handles star bullets and 1) numbering without blank lines', () => {
    const c = view('Steps:\n1) one\n2) two\n\nTips:\n* **a** x\n* b');
    expect(c.querySelectorAll('ol li')).toHaveLength(2);
    expect(c.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('keeps Telugu and Hindi text auto-directed', () => {
    const c = view('**నమస్కారం**\n- नमस्ते **दोस्त**');
    expect(c.querySelector('li')?.getAttribute('dir')).toBe('auto');
    expect(c.querySelector('strong')?.textContent).toBe('నమస్కారం');
  });
});
