// Pure helpers for the file actions in "Explain with Flick": tables, receipts, photo presets.

export const PHOTO_PRESETS = [
  {
    label: 'Solve this',
    question: 'Solve the problem shown in this image. Show the steps briefly.',
  },
  {
    label: 'Explain this error',
    question: 'Explain the error shown in this image: what it means and how to fix it.',
  },
  { label: 'What is this?', question: 'What is this? Name it and say what it is used for.' },
  { label: 'Read the text', question: 'Read out all the text that is visible in this image.' },
] as const;

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

const isSeparator = (line: string): boolean =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Rows of the first markdown table in `text` (header first); empty when there is none. */
export function parseMarkdownTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|')) {
      if (rows.length) break;
      continue;
    }
    if (isSeparator(line)) continue;
    rows.push(splitRow(line));
  }
  return rows;
}

const csvCell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const tableToCsv = (rows: string[][]): string =>
  rows.map((r) => r.map(csvCell).join(',')).join('\n');

export interface Receipt {
  merchant: string;
  date: string;
  currency: string;
  total: number | null;
  items: { name: string; price: number | null }[];
}

/** Reads the JSON Flick returns for a receipt; null when it is not usable. */
export function parseReceipt(text: string): Receipt | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const items = Array.isArray(raw.items)
      ? raw.items.flatMap((i: unknown) => {
          const o = (i ?? {}) as Record<string, unknown>;
          const name = str(o.name);
          return name ? [{ name, price: num(o.price) }] : [];
        })
      : [];
    const receipt = {
      merchant: str(raw.merchant),
      date: str(raw.date),
      currency: str(raw.currency),
      total: num(raw.total),
      items,
    };
    return receipt.merchant || receipt.total !== null || items.length ? receipt : null;
  } catch {
    return null;
  }
}

/** The receipt as a plain text message for Saved messages. */
export function receiptToText(r: Receipt): string {
  const money = (n: number | null): string =>
    n === null ? '' : `${r.currency ? `${r.currency} ` : ''}${n.toFixed(2)}`;
  const lines = [`Receipt: ${r.merchant || 'Unknown merchant'}${r.date ? ` (${r.date})` : ''}`];
  for (const i of r.items)
    lines.push(`- ${i.name}${i.price !== null ? `: ${money(i.price)}` : ''}`);
  if (r.total !== null) lines.push(`Total: ${money(r.total)}`);
  return lines.join('\n');
}
