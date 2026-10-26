// Five suggested meeting times over the next days, for the "Find a time" poll.

const HOURS = [12, 18, 19, 10, 17];

/** Local-time slots on the next days, skipping nothing: lunch, evening and weekend morning mix. */
export function suggestSlots(now: Date, count = 5): Date[] {
  const slots: Date[] = [];
  for (let day = 1; slots.length < count && day < 15; day++) {
    const d = new Date(now);
    d.setDate(d.getDate() + day);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    d.setHours(weekend ? 11 : (HOURS[slots.length % HOURS.length] ?? 11), 0, 0, 0);
    slots.push(d);
  }
  return slots;
}

export const slotLabel = (d: Date): string =>
  `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
