// The "Aa" toolbar: put markdown around the selected text of the message box.

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'codeblock'
  | 'heading'
  | 'bullet'
  | 'numbered'
  | 'quote'
  | 'link'
  | 'table';

export interface FormatResult {
  text: string;
  /** Where the selection (or caret) goes afterwards. */
  start: number;
  end: number;
}

const WRAP: Partial<Record<FormatKind, string>> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
};

const LINE_PREFIX: Partial<Record<FormatKind, (n: number) => string>> = {
  heading: () => '## ',
  bullet: () => '- ',
  numbered: (n) => `${String(n + 1)}. `,
  quote: () => '> ',
};

/** 3 columns, a header and two empty rows. */
export const TABLE_TEMPLATE =
  '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |';

/** Apply one formatting action to the text, given the current selection. */
export const applyFormat = (
  kind: FormatKind,
  text: string,
  selStart: number,
  selEnd: number,
): FormatResult => {
  const selected = text.slice(selStart, selEnd);
  const replace = (
    insert: string,
    from: number,
    to: number,
    a: number,
    b: number,
  ): FormatResult => ({
    text: text.slice(0, from) + insert + text.slice(to),
    start: a,
    end: b,
  });

  const mark = WRAP[kind];
  if (mark) {
    return replace(
      mark + selected + mark,
      selStart,
      selEnd,
      selStart + mark.length,
      selEnd + mark.length,
    );
  }

  if (kind === 'codeblock') {
    const lead = selStart > 0 && text[selStart - 1] !== '\n' ? '\n' : '';
    const open = `${lead}\`\`\`\n`;
    return replace(
      `${open}${selected}\n\`\`\``,
      selStart,
      selEnd,
      selStart + open.length,
      selStart + open.length + selected.length,
    );
  }

  if (kind === 'link') {
    const label = selected || 'text';
    const url = 'https://';
    const insert = `[${label}](${url})`;
    // The address is left selected, ready to be typed over.
    const urlStart = selStart + label.length + 3;
    return replace(insert, selStart, selEnd, urlStart, urlStart + url.length);
  }

  if (kind === 'table') {
    const lead = selStart > 0 && text[selStart - 1] !== '\n' ? '\n' : '';
    const insert = lead + TABLE_TEMPLATE;
    return replace(insert, selStart, selEnd, selStart + insert.length, selStart + insert.length);
  }

  // Line-based: every line the selection touches gets the prefix.
  const prefix = LINE_PREFIX[kind];
  if (!prefix) return { text, start: selStart, end: selEnd };
  const from = text.lastIndexOf('\n', selStart - 1) + 1;
  const nl = text.indexOf('\n', selEnd);
  const to = nl === -1 ? text.length : nl;
  const lines = text.slice(from, to).split('\n');
  const out = lines.map((l, i) => prefix(i) + l).join('\n');
  return replace(out, from, to, from, from + out.length);
};

/** Ctrl/Cmd+B, I and E. Null for any other key. */
export const shortcutKind = (e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): FormatKind | null => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  return key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'e' ? 'code' : null;
};
