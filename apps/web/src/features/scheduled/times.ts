import { LIMITS } from '@chat/contracts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The value format of <input type="datetime-local">, in the browser's own time zone. */
export const toInputValue = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The earliest and latest time the server accepts (a little inside the limits, since time passes). */
export const pickableRange = (now: Date): { min: Date; max: Date } => ({
  min: new Date(now.getTime() + (LIMITS.SCHEDULE_MIN_LEAD_S + 60) * 1000),
  max: new Date(now.getTime() + (LIMITS.SCHEDULE_MAX_LEAD_S - 3600) * 1000),
});

export const oneHourFrom = (now: Date): Date => new Date(now.getTime() + 3_600_000);

/** Quick choices: in an hour, and tomorrow at 09:00. */
export const presets = (now: Date): { label: string; at: Date }[] => {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return [
    { label: 'In 1 hour', at: oneHourFrom(now) },
    { label: 'Tomorrow 09:00', at: tomorrow },
  ];
};

/**
 * Turns the field's value into a send time, or an error message. An empty or half-typed field
 * and a time outside the allowed range are both refused here, before asking the server.
 */
export const parsePicked = (
  value: string,
  now: Date,
): { ok: true; at: Date } | { ok: false; error: string } => {
  const at = new Date(value);
  if (!value || Number.isNaN(at.getTime())) return { ok: false, error: 'Pick a date and time.' };
  const { min, max } = pickableRange(now);
  if (at < min) return { ok: false, error: 'Pick a time at least a few minutes from now.' };
  if (at > max) return { ok: false, error: 'Pick a time within the next year.' };
  return { ok: true, at };
};
