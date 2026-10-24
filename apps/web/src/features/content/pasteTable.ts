// Pasting a table from a spreadsheet or a web page turns it into a markdown (GFM) pipe table.

type Rows = string[][];

/** Tab-separated rows (what Excel and Google Sheets put on the clipboard). Null if it is not one. */
export const rowsFromTsv = (text: string): Rows | null => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  // Code indented with tabs is not a table: every table line has a tab and the header starts with a cell.
  if (lines.length < 2 || lines.some((l) => !l.includes('\t')) || /^\s/.test(lines[0] ?? ''))
    return null;
  return lines.map((l) => l.split('\t'));
};

/** The cells of the first <table> in some HTML, or null. */
export const rowsFromHtml = (html: string): Rows | null => {
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  if (!table) return null;
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  );
  return rows.length > 0 && rows.some((r) => r.length > 0) ? rows : null;
};

const cell = (value: string): string => value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();

/** Header row, separator row, body rows. Short rows are padded so every row has the same columns. */
export const toMarkdownTable = (rows: Rows): string => {
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
  const [head = [], ...body] = rows;
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return [line(head), separator, ...body.map(line)].join('\n');
};

/** The markdown table for what was copied, or null if the clipboard holds no table. */
export const tableFromClipboard = (data: Pick<DataTransfer, 'getData'>): string | null => {
  const html = data.getData('text/html');
  const rows = (html ? rowsFromHtml(html) : null) ?? rowsFromTsv(data.getData('text/plain'));
  return rows ? toMarkdownTable(rows) : null;
};
