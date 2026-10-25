import { LIMITS } from '@chat/contracts';

// Pure time helpers for "Remind me". They take `now` as an argument so tests can fix the clock.

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

/** The earliest and latest time the server accepts (a little inside the limits, since time passes). */
export const pickableRange = (now: Date): { min: Date; max: Date } => ({
  min: new Date(now.getTime() + (LIMITS.REMINDER_MIN_LEAD_S + 60) * 1000),
  max: new Date(now.getTime() + (LIMITS.REMINDER_MAX_LEAD_S - 3600) * 1000),
});

const at = (base: Date, daysAhead: number, hour: number): Date => {
  const d = new Date(base);
  d.setDate(base.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
};

export interface Preset {
  label: string;
  at: Date;
}

/**
 * Quick choices. "This evening" is left out once 6 pm is too close (or past), because it would
 * be refused as too soon.
 */
export const presets = (now: Date): Preset[] => {
  const evening = at(now, 0, EVENING_HOUR);
  const list: Preset[] = [{ label: 'In 1 hour', at: new Date(now.getTime() + 3_600_000) }];
  if (evening >= pickableRange(now).min) list.push({ label: 'This evening (6 pm)', at: evening });
  list.push(
    { label: 'Tomorrow 9 am', at: at(now, 1, MORNING_HOUR) },
    // The same weekday next week, in the morning.
    { label: 'Next week', at: at(now, 7, MORNING_HOUR) },
  );
  return list;
};

/**
 * Turns the field's value into a time, or an error message. An empty or half-typed field and a
 * time outside the allowed range are refused here, before asking the server.
 */
export const parsePicked = (
  value: string,
  now: Date,
): { ok: true; at: Date } | { ok: false; error: string } => {
  const picked = new Date(value);
  if (!value || Number.isNaN(picked.getTime())) {
    return { ok: false, error: 'Pick a date and time.' };
  }
  const { min, max } = pickableRange(now);
  if (picked < min) return { ok: false, error: 'Pick a time at least a few minutes from now.' };
  if (picked > max) return { ok: false, error: 'Pick a time within the next year.' };
  return { ok: true, at: picked };
};

const clock = (date: Date): string =>
  date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "today at 6:00 PM", "tomorrow at 9:00 AM" or "on Mon, Jun 15 at 9:00 AM", for the confirmation. */
export const describeWhen = (when: Date, now: Date): string => {
  const dayStart = (d: Date): number => new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round((dayStart(when) - dayStart(now)) / 86_400_000);
  if (days === 0) return `today at ${clock(when)}`;
  if (days === 1) return `tomorrow at ${clock(when)}`;
  const date = when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `on ${date} at ${clock(when)}`;
};
