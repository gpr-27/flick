import { describe, expect, it } from 'vitest';
import { parseMarkdownTable, parseReceipt, receiptToText, tableToCsv } from './fileTools';

describe('fileTools', () => {
  it('turns a markdown table into CSV', () => {
    const rows = parseMarkdownTable('Here:\n| Name | Note |\n|---|---|\n| Ann | a, "b" |\n\nafter');
    expect(rows).toEqual([
      ['Name', 'Note'],
      ['Ann', 'a, "b"'],
    ]);
    expect(tableToCsv(rows)).toBe('Name,Note\nAnn,"a, ""b"""');
  });

  it('finds no table in plain text', () => {
    expect(parseMarkdownTable('No table found.')).toEqual([]);
  });

  it('parses a receipt, even inside a code fence, and formats it', () => {
    const r = parseReceipt(
      '```json\n{"merchant":"Cafe","date":"2026-01-02","currency":"USD","total":7.5,"items":[{"name":"Latte","price":5},{"name":"","price":1}]}\n```',
    );
    expect(r?.items).toHaveLength(1);
    expect(receiptToText(r!)).toBe(
      'Receipt: Cafe (2026-01-02)\n- Latte: USD 5.00\nTotal: USD 7.50',
    );
    expect(parseReceipt('not json')).toBeNull();
  });
});
