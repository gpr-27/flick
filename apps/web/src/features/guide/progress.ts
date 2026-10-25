// What the guide remembers about one person, and the rules for combining two copies (this device
// and the server). Pure functions, so the rules are easy to test. Only topic ids and times.
import { GUIDE_MAX_TOPICS, GuideTopicId } from '@chat/contracts';
import { z } from 'zod';

export type Times = Record<string, string>;

export interface Progress {
  /** Topics the person has been shown (topic id -> ISO time). */
  seen: Times;
  /** Topics whose feature the person has already used: never shown as a tip. */
  used: Times;
  /** When the welcome tour was finished or closed; null = not yet. */
  welcomeDoneAt: string | null;
  /** "Show tips as I use new features". */
  enabled: boolean;
  /** The server's change counter, for information. */
  version: number;
}

/** What is kept on this device: the progress plus a few things that are only about this device. */
export interface StoredGuide extends Progress {
  /** Whose progress this is, so a second account in the same browser starts clean. */
  userId: string | null;
  /** Where the welcome tour stopped (a step number) while it is unfinished; null = not started or done. */
  resumeStep: number | null;
  /** The person pressed "Reset the guide" and the server has not heard yet. */
  pendingReset: boolean;
  /** The "enabled" switch was changed here and the server has not heard yet. */
  enabledDirty: boolean;
  /** There are changes the server has not heard yet. */
  dirty: boolean;
}

export const EMPTY_PROGRESS: Progress = {
  seen: {},
  used: {},
  welcomeDoneAt: null,
  enabled: true,
  version: 0,
};

export const EMPTY_STORED: StoredGuide = {
  ...EMPTY_PROGRESS,
  userId: null,
  resumeStep: null,
  pendingReset: false,
  enabledDirty: false,
  dirty: false,
};

const isoTime = z.iso.datetime({ offset: true });

/** Keeps only valid topic ids with valid times, at most GUIDE_MAX_TOPICS of them. */
export function cleanTimes(raw: unknown): Times {
  const clean: Times = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return clean;
  for (const [id, at] of Object.entries(raw)) {
    if (Object.keys(clean).length >= GUIDE_MAX_TOPICS) break;
    if (GuideTopicId.safeParse(id).success && isoTime.safeParse(at).success)
      clean[id] = at as string;
  }
  return clean;
}

/** Reads what localStorage held. Anything damaged falls back to its default instead of failing. */
export function readStored(raw: unknown): StoredGuide {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_STORED };
  const r = raw as Record<string, unknown>;
  const time = (v: unknown): string | null => (isoTime.safeParse(v).success ? (v as string) : null);
  const step =
    typeof r.resumeStep === 'number' && r.resumeStep >= 0 ? Math.floor(r.resumeStep) : null;
  return {
    userId: typeof r.userId === 'string' ? r.userId : null,
    seen: cleanTimes(r.seen),
    used: cleanTimes(r.used),
    welcomeDoneAt: time(r.welcomeDoneAt),
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    version: typeof r.version === 'number' && r.version >= 0 ? Math.floor(r.version) : 0,
    resumeStep: step,
    pendingReset: r.pendingReset === true,
    enabledDirty: r.enabledDirty === true,
    dirty: r.dirty === true,
  };
}

/** Both lists combined; when a topic is in both, the earlier time wins. Nothing is ever dropped. */
export function unionTimes(a: Times, b: Times): Times {
  const merged: Times = { ...a };
  for (const [id, at] of Object.entries(b)) {
    const current = merged[id];
    if (current === undefined) {
      if (Object.keys(merged).length < GUIDE_MAX_TOPICS) merged[id] = at;
    } else if (at < current) merged[id] = at;
  }
  return merged;
}

/** The earlier of two optional times. */
export const earliest = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a < b ? a : b;

/** True when `a` holds a topic (or a welcome time) that `b` does not. */
export function hasExtra(
  a: Pick<Progress, 'seen' | 'used' | 'welcomeDoneAt'>,
  b: Pick<Progress, 'seen' | 'used' | 'welcomeDoneAt'>,
): boolean {
  const more = (x: Times, y: Times): boolean => Object.keys(x).some((id) => !(id in y));
  return (
    more(a.seen, b.seen) ||
    more(a.used, b.used) ||
    (a.welcomeDoneAt !== null && b.welcomeDoneAt === null)
  );
}
