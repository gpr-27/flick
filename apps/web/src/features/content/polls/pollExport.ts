// "Export results": a CSV of the poll with one row per option (count and voter names).
import type { PollTally } from './pollTypes';

/** Quotes a CSV cell; a leading = + - @ is neutralised so a spreadsheet never runs it as a formula. */
export const csvCell = (value: string): string => {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const pollCsv = (tally: PollTally, nameOf: (userId: string) => string): string => {
  const rows = [
    ['Question', tally.question],
    ['Closes', tally.closes_at ?? 'never'],
    [],
    ['Option', 'Votes', 'Voters'],
    ...tally.options.map((o) => [
      o.text,
      String(o.voter_ids.length),
      o.voter_ids.map(nameOf).join('; '),
    ]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
};

/** True once the closing time has passed. */
export const isPollClosed = (closesAt: string | null | undefined, now = Date.now()): boolean =>
  !!closesAt && new Date(closesAt).getTime() <= now;
