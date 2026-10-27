// Limits shared by client and server. They are design defaults, not measured capacities.

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

export const LIMITS = {
  /** Max size of one Socket.IO message (UTF-8 bytes). A max-length text message is at most ~260 KB (4-byte characters), so 1 MiB leaves room. */
  MAX_FRAME_BYTES: 1 * MiB,
  /** Max characters in a text message or caption. */
  MAX_TEXT_LENGTH: 65_000,
  MAX_CAPTION_LENGTH: 16_000,
  /** Max delivery acks in one frame. */
  MAX_ACKS_PER_FRAME: 200,
  /** Max conversations in one sync_request. */
  MAX_SYNC_CURSORS: 1_000,
  DEFAULT_SYNC_PAGE_SIZE: 200,
  MAX_SYNC_PAGE_SIZE: 500,
  /** Max users one connection can watch for presence. */
  MAX_PRESENCE_SUBSCRIPTIONS: 256,
  MAX_SDP_LENGTH: 64 * KiB,
  /** Default and max page size for REST lists. */
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  MAX_GROUP_MEMBERS: 1_024,
  /** Groups up to this size are fanned out in one pass; bigger ones are sent in batches. */
  INLINE_FANOUT_MAX_MEMBERS: 256,
  FANOUT_BATCH_SIZE: 500,
  MAX_UPLOAD_BYTES: 1 * GiB,
  /** Most photos and videos one album (a multi-select send) may hold. */
  MAX_ALBUM_ITEMS: 20,
  /** Most bytes one album send may add up to (each file is still limited by MAX_UPLOAD_BYTES). */
  MAX_ALBUM_BYTES: 2 * GiB,
  /** Uploads of one album that run at the same time; the rest wait their turn. */
  MAX_ALBUM_CONCURRENT_UPLOADS: 3,
  MAX_AVATAR_BYTES: 5 * MiB,
  /** Max characters in the profile "about" line. */
  MAX_ABOUT_LENGTH: 139,
  /** A scheduled message must be at least this far ahead (the worker checks once a minute)... */
  SCHEDULE_MIN_LEAD_S: 60,
  /** ...and at most this far ahead (one year). */
  SCHEDULE_MAX_LEAD_S: 365 * 86_400,
  /** Max waiting (pending or failed) scheduled messages per user. */
  MAX_SCHEDULED_PER_USER: 50,
  /** A reminder must be at least a minute ahead (the worker checks once a minute), at most a year. */
  REMINDER_MIN_LEAD_S: 60,
  REMINDER_MAX_LEAD_S: 365 * 86_400,
  /** Max characters in the optional note of a reminder. */
  MAX_REMINDER_NOTE_LENGTH: 200,
  /** Max waiting (pending) reminders per user. */
  MAX_PENDING_REMINDERS_PER_USER: 50,
  /** Reminders that were already sent stay in the list this long. */
  REMINDER_SENT_VISIBLE_S: 3 * 86_400,
} as const;

export const TYPING = {
  /** Client sends typing_start at most this often. */
  THROTTLE_MS: 3_000,
  /** Receivers hide the indicator after this long, so a lost typing_stop heals itself. */
  TTL_MS: 6_000,
} as const;

/** Allowed disappearing-message timers in seconds (0 = off). */
export const DISAPPEARING_TIMERS = [0, 86_400, 604_800, 7_776_000] as const;

/** UTF-8 byte length without allocating a buffer. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    ) {
      bytes += 4; // surrogate pair = one 4-byte code point
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** A byte count for people: 1536 -> "1.5 KB", 1073741824 -> "1 GB". Uses 1024-based units. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
