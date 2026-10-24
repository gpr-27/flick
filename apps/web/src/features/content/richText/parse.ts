// A small markdown parser for chat messages (a GFM subset). It only produces plain data; the
// renderer turns that into React elements, so no raw HTML from a message is ever used.
//
// Supported blocks: headings, paragraphs, fenced code, block quotes, rules, ordered, bullet,
// nested and task lists, and pipe tables.

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** null for a normal item, true/false for "- [x]" / "- [ ]". */
  task: boolean | null;
  blocks: Block[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'hr' }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'table'; head: string[]; aligns: Align[]; rows: string[][] };

/** Deeper nesting (quotes inside quotes, lists inside lists) is shown as plain text. */
const MAX_DEPTH = 8;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
/** Items that may interrupt a paragraph: bullets and "1." only. */
const INTERRUPTING_ITEM = /^ {0,3}(?:[-*+]|1[.)])\s+\S/;
const DELIMITER_CELL = /^\s*:?-+:?\s*$/;

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Cells of a pipe row: outer pipes dropped, "\|" kept as a literal pipe. */
export const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
};

const isTableStart = (lines: readonly string[], i: number): boolean => {
  const head = lines[i];
  const delimiter = lines[i + 1];
  if (head === undefined || delimiter === undefined) return false;
  if (!head.includes('|') || !delimiter.includes('|') || !/^[\s|:-]+$/.test(delimiter)) {
    return false;
  }
  const cells = splitRow(delimiter);
  return cells.every((c) => DELIMITER_CELL.test(c)) && cells.length === splitRow(head).length;
};

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
};

const startsBlock = (lines: readonly string[], i: number): boolean => {
  const line = lines[i] ?? '';
  return (
    line.trim() === '' ||
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    INTERRUPTING_ITEM.test(line) ||
    isTableStart(lines, i)
  );
};

const parseList = (
  lines: readonly string[],
  from: number,
  depth: number,
): { block: Block; next: number } => {
  const first = ITEM.exec(lines[from] ?? '');
  const base = first?.[1]?.length ?? 0;
  const marker = first?.[2] ?? '-';
  const ordered = /\d/.test(marker);
  const items: ListItem[] = [];
  let i = from;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = ITEM.exec(line);
    if (!m || HR.test(line) || m[1]?.length !== base || /\d/.test(m[2] ?? '') !== ordered) break;
    // Item text continues on lines indented past the marker, or lazily on the next line.
    const contentIndent = line.length - (m[3]?.length ?? 0);
    const itemLines = [m[3] ?? ''];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '') {
        let j = i + 1;
        while (j < lines.length && (lines[j] ?? '').trim() === '') j++;
        if (j < lines.length && indentOf(lines[j] ?? '') > base) {
          itemLines.push('');
          i++;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind > base) {
        itemLines.push(l.slice(Math.min(ind, contentIndent)));
        i++;
      } else if (
        ITEM.test(l) ||
        HR.test(l) ||
        FENCE.test(l) ||
        HEADING.test(l) ||
        QUOTE.test(l) ||
        itemLines[itemLines.length - 1] === ''
      ) {
        break;
      } else {
        itemLines.push(l.trim());
        i++;
      }
    }
    while (itemLines[itemLines.length - 1] === '') itemLines.pop();

    let task: boolean | null = null;
    const t = /^\[([ xX])\]\s+(.*)$/.exec(itemLines[0] ?? '');
    if (t) {
      task = t[1] !== ' ';
      itemLines[0] = t[2] ?? '';
    }
    items.push({ task, blocks: parseLines(itemLines, depth + 1) });
  }
  const start = ordered ? Number.parseInt(marker, 10) : 1;
  return { block: { kind: 'list', ordered, start, items }, next: i };
};

const parseLines = (lines: readonly string[], depth: number): Block[] => {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (depth >= MAX_DEPTH) {
      blocks.push({ kind: 'para', text: lines.slice(i).join('\n') });
      break;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1] ?? '```';
      const close = new RegExp(`^ {0,3}\\${mark[0] ?? '`'}{${mark.length},}\\s*$`);
      const code: string[] = [];
      i++;
      // A fence that is never closed (a cut-short reply) runs to the end of the text.
      while (i < lines.length && !close.test(lines[i] ?? '')) code.push(lines[i++] ?? '');
      i++;
      blocks.push({ kind: 'code', lang: fence[2] ?? '', code: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2] ?? '',
      });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] ?? '');
        if (!q) break;
        inner.push(q[1] ?? '');
        i++;
      }
      blocks.push({ kind: 'quote', blocks: parseLines(inner, depth + 1) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1] ?? '').map(alignOf);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').includes('|') && !startsBlock(lines, i)) {
        // Short rows are padded and long rows cut, so every row has a cell per column.
        const cells = splitRow(lines[i] ?? '').slice(0, head.length);
        while (cells.length < head.length) cells.push('');
        rows.push(cells);
        i++;
      }
      blocks.push({ kind: 'table', head, aligns, rows });
      continue;
    }

    if (ITEM.test(line)) {
      const { block, next } = parseList(lines, i, depth);
      blocks.push(block);
      i = next;
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && !startsBlock(lines, i)) para.push(lines[i++] ?? '');
    blocks.push({ kind: 'para', text: para.join('\n') });
  }
  return blocks;
};

export const parseBlocks = (source: string): Block[] =>
  parseLines(
    source
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length))),
    0,
  );
