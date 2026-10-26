const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Turns a time word from a promise ("tuesday", "tomorrow") into 9 am on that day; null if unknown. */
export const hintToDate = (hint: string | null, now: Date): Date | null => {
  if (!hint) return null;
  const at = (daysAhead: number, hour = 9): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  if (hint === 'today' || hint === 'tonight' || hint.startsWith('end of')) {
    const evening = at(0, 18);
    return evening.getTime() > now.getTime() + 15 * 60_000 ? evening : at(1);
  }
  if (hint === 'tomorrow') return at(1);
  if (hint === 'next week') return at(7);
  if (hint === 'this week') return at(3);
  const day = DAYS.indexOf(hint);
  if (day < 0) return null;
  const ahead = (day - now.getDay() + 7) % 7 || 7;
  return at(ahead);
};
