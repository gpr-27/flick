// Plain text out of PDFs, Word documents and spreadsheets. Used when a model cannot read the
// file itself. The result is still untrusted data and gets fenced by the caller.

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const isDocx = (mime: string, name: string | null): boolean =>
  mime === DOCX_MIME || /\.docx$/i.test(name ?? '');
export const isXlsx = (mime: string, name: string | null): boolean =>
  mime === XLSX_MIME || /\.xlsx$/i.test(name ?? '');

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function docxText(bytes: Uint8Array): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

/** Every sheet as CSV-like rows, one block per sheet. */
export async function xlsxText(bytes: Uint8Array): Promise<string> {
  const ExcelJS = (await import('exceljs')).default;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const blocks: string[] = [];
  book.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      rows.push(cells.join(','));
    });
    blocks.push(`Sheet: ${sheet.name}\n${rows.join('\n')}`);
  });
  return blocks.join('\n\n');
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    return '';
  }
  const s =
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    typeof v === 'bigint'
      ? String(v)
      : '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
