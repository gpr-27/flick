export interface QuietSettings {
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  quiet_timezone: string;
  quiet_days: number[];
}

/**
 * True when `now` falls inside the person's quiet hours (and today is one of the chosen days).
 * Same logic as isQuietNow in the contracts package (the worker does not depend on it).
 * A window like 22:00-07:00 crosses midnight; the day counted is the day the window started.
 */
export function isQuietNow(s: QuietSettings, now: Date = new Date()): boolean {
  if (!s.quiet_enabled) return false;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: s.quiet_timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return false;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const toMin = (c: string) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
  const start = toMin(s.quiet_start);
  const end = toMin(s.quiet_end);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end && s.quiet_days.includes(day);
  if (minutes >= start) return s.quiet_days.includes(day);
  if (minutes < end) return s.quiet_days.includes((day + 6) % 7);
  return false;
}
