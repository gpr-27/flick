// Pure month-grid math for the calendar page. Weeks start on Monday.

export interface CalendarItem {
  id: string;
  kind: 'reminder' | 'scheduled';
  at: string; // ISO time
  title: string;
}

export const dayKey = (d: Date): string =>
  `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Always 6 weeks x 7 days, starting on the Monday on or before the 1st. */
export const monthGrid = (year: number, month: number): Date[] => {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i));
};

export const addMonths = (
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } => {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

/** Items grouped by local day, each day's list in time order. */
export const groupByDay = (items: CalendarItem[]): Map<string, CalendarItem[]> => {
  const map = new Map<string, CalendarItem[]>();
  for (const item of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = dayKey(new Date(item.at));
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
};
