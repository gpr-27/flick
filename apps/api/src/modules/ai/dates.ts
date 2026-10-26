// A small deterministic date parser for "do it for me" and the plan assistant. It understands the
// common phrases people type ("tomorrow 9am", "Friday 6pm", "in 2 hours", "next week") and
// returns null for anything else. All maths is in the person's own time zone, given as minutes
// east of UTC, so the answer does not depend on where the server runs.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Default time of day when only a day is given. */
const DEFAULT_HOUR = 9;

interface Zoned {
  y: number;
  m: number;
  d: number;
  hour: number;
  min: number;
  weekday: number;
}

/** The wall-clock fields of `ms` for someone `tz` minutes east of UTC. */
function toZoned(ms: number, tz: number): Zoned {
  const t = new Date(ms + tz * MINUTE);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    d: t.getUTCDate(),
    hour: t.getUTCHours(),
    min: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
  };
}

/** The instant for a wall-clock time of someone `tz` minutes east of UTC. */
const fromWall = (y: number, m: number, d: number, hour: number, min: number, tz: number): number =>
  Date.UTC(y, m, d, hour, min) - tz * MINUTE;

/** "6pm", "6:30 pm", "18:00", "at 9". Returns the minutes since midnight, or null. */
export function parseTimeOfDay(text: string): number | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return 12 * 60;
  if (/\bmidnight\b/.test(t)) return 0;
  const m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/.exec(t);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h < 1 || h > 12 || min > 59) return null;
    const pm = m[3]!.startsWith('p');
    if (h === 12) h = 0;
    return (pm ? h + 12 : h) * 60 + min;
  }
  const h24 = /\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  if (h24) return Number(h24[1]) * 60 + Number(h24[2]);
  const bare = /\bat\s+(\d{1,2})\b/.exec(t);
  if (bare && Number(bare[1]) <= 23) return Number(bare[1]) * 60;
  if (/\bmorning\b/.test(t)) return 9 * 60;
  if (/\bafternoon\b/.test(t)) return 15 * 60;
  if (/\bevening\b/.test(t)) return 19 * 60;
  if (/\bnight\b|\btonight\b/.test(t)) return 21 * 60;
  return null;
}

/**
 * The moment `phrase` means, as an ISO string, or null when it is not understood.
 * Phrases about a day with no time use 09:00. A time that already passed today moves to tomorrow
 * when no day was named ("at 6pm").
 */
export function parseWhen(phrase: string, now: Date, tzOffsetMin: number): string | null {
  const text = phrase.toLowerCase().replace(/[,.!]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const nowMs = now.getTime();

  // Relative durations: "in 2 hours", "in 30 minutes", "in 3 days", "in a week".
  const rel = /\bin (an?|\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/.exec(text);
  if (rel) {
    const n = rel[1]!.startsWith('a') ? 1 : Number(rel[1]);
    const unit = rel[2]!;
    const ms = unit.startsWith('m')
      ? MINUTE
      : unit.startsWith('h')
        ? HOUR
        : unit.startsWith('d')
          ? DAY
          : 7 * DAY;
    const out = nowMs + n * ms;
    // "in 2 days at 5pm": keep the day, set the time.
    const tod = parseTimeOfDay(text.replace(rel[0], ''));
    if (tod !== null && ms >= DAY) return withTime(out, tod, tzOffsetMin);
    return new Date(out).toISOString();
  }

  const tod = parseTimeOfDay(text);
  const z = toZoned(nowMs, tzOffsetMin);
  const startOfToday = fromWall(z.y, z.m, z.d, 0, 0, tzOffsetMin);
  let dayMs: number | null = null;

  if (/\bday after tomorrow\b/.test(text)) dayMs = startOfToday + 2 * DAY;
  else if (/\btomorrow\b/.test(text)) dayMs = startOfToday + DAY;
  else if (/\b(today|tonight)\b/.test(text)) dayMs = startOfToday;
  else if (/\bnext week\b/.test(text)) {
    // Monday of next week.
    const untilMonday = (1 - z.weekday + 7) % 7 || 7;
    dayMs = startOfToday + untilMonday * DAY;
  } else if (/\bweekend\b/.test(text)) {
    dayMs = startOfToday + ((6 - z.weekday + 7) % 7 || 7) * DAY;
  } else {
    const idx = DAYS.findIndex((d) => new RegExp(`\\b(${d}|${d.slice(0, 3)})\\b`).test(text));
    if (idx >= 0) {
      let ahead = (idx - z.weekday + 7) % 7;
      if (ahead === 0 && tod !== null && tod * MINUTE <= nowMs - startOfToday) ahead = 7;
      if (/\bnext\b/.test(text) && ahead === 0) ahead = 7;
      dayMs = startOfToday + ahead * DAY;
    }
  }

  if (dayMs === null) {
    if (tod === null) return null;
    // Only a time: today if still ahead, else tomorrow.
    const today = startOfToday + tod * MINUTE;
    return new Date(today > nowMs ? today : today + DAY).toISOString();
  }
  return withTime(dayMs, tod ?? DEFAULT_HOUR * 60, tzOffsetMin);
}

/** `ms` (any moment of a day) moved to `minutes` after midnight of that day. */
function withTime(ms: number, minutes: number, tz: number): string {
  const z = toZoned(ms, tz);
  return new Date(fromWall(z.y, z.m, z.d, 0, 0, tz) + minutes * MINUTE).toISOString();
}

/**
 * Up to `count` start times on the day of `target`, at the time asked for or in the evening,
 * skipping any time within `gapMin` of a busy moment (the person's own reminders and scheduled
 * messages). The first suggestion is the requested time when it is free.
 */
export function suggestSlots(
  target: Date,
  busy: Date[],
  tzOffsetMin: number,
  opts: { count?: number; gapMin?: number; hours?: number[] } = {},
): string[] {
  const { count = 3, gapMin = 60 } = opts;
  const z = toZoned(target.getTime(), tzOffsetMin);
  const requested = z.hour * 60 + z.min;
  const hours = opts.hours ?? [18, 19, 20, 12, 13, 17];
  const candidates = [requested, ...hours.map((h) => h * 60)].filter(
    (v, i, all) => all.indexOf(v) === i,
  );
  const out: string[] = [];
  for (const minutes of candidates) {
    const at = fromWall(z.y, z.m, z.d, 0, 0, tzOffsetMin) + minutes * MINUTE;
    if (busy.some((b) => Math.abs(b.getTime() - at) < gapMin * MINUTE)) continue;
    out.push(new Date(at).toISOString());
    if (out.length === count) break;
  }
  return out.sort();
}
