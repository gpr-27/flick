import { describe, expect, it } from 'vitest';
import { csvCell, isPollClosed, pollCsv } from './pollExport';

describe('poll export', () => {
  it('quotes cells and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  it('writes one row per option with voter names', () => {
    const csv = pollCsv(
      {
        message_id: 'm',
        question: 'Lunch?',
        allow_multiple: false,
        options: [
          { index: 0, text: 'Pizza', voter_ids: ['a', 'b'] },
          { index: 1, text: 'Sushi', voter_ids: [] },
        ],
      },
      (id) => id.toUpperCase(),
    );
    expect(csv).toContain('Pizza,2,A; B');
    expect(csv).toContain('Sushi,0,');
    expect(csv.startsWith('Question,Lunch?')).toBe(true);
  });

  it('knows when a poll is closed', () => {
    expect(isPollClosed(undefined)).toBe(false);
    expect(isPollClosed('2020-01-01T00:00:00.000Z')).toBe(true);
    expect(isPollClosed('2999-01-01T00:00:00.000Z')).toBe(false);
  });
});
