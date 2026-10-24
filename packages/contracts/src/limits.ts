// Limits shared by client and server. They are design defaults, not measured capacities.

const KiB = 1024;
const MiB = 1024 * KiB;

export const LIMITS = {
  /** Max size of one Socket.IO message (UTF-8 bytes). A max-length text message is ~64 KiB, so 256 KiB leaves room. */
  MAX_FRAME_BYTES: 256 * KiB,
  /** Max characters in a text message or caption. */
  MAX_TEXT_LENGTH: 16_000,
  MAX_CAPTION_LENGTH: 4_000,
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
  MAX_UPLOAD_BYTES: 100 * MiB,
  MAX_AVATAR_BYTES: 5 * MiB,
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
