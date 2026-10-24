// The decisions behind in-tab notifications, as plain functions so they are easy to test.
import type { MessageContent, MessageRecord } from '@chat/contracts';

/** A message older than this came from catching up after being offline, not a live arrival. */
export const MAX_LIVE_AGE_MS = 60_000;
/** At most one notification sound per second, however many messages arrive. */
export const SOUND_MIN_GAP_MS = 1_000;

/** Server-written or bookkeeping messages never notify. */
const QUIET_TYPES: ReadonlySet<string> = new Set(['system', 'call_event', 'poll_vote']);

export const isMuted = (mutedUntil: string | null, now: number): boolean =>
  mutedUntil !== null && Date.parse(mutedUntil) > now;

export const mentionsUser = (content: MessageContent | null, userId: string): boolean =>
  content !== null && 'mentions' in content && (content.mentions?.includes(userId) ?? false);

export interface NotifyInput {
  message: MessageRecord;
  myId: string;
  mutedUntil: string | null;
  tabHidden: boolean;
  now: number;
}

/** Notify for a live message from someone else while the tab is hidden. Mute is bypassed by a mention. */
export const shouldNotify = ({
  message,
  myId,
  mutedUntil,
  tabHidden,
  now,
}: NotifyInput): boolean => {
  if (!tabHidden) return false;
  if (message.sender_user_id === null || message.sender_user_id === myId) return false;
  if (message.deleted_at !== null || message.content === null) return false;
  if (QUIET_TYPES.has(message.content.type)) return false;
  if (now - Date.parse(message.created_at) > MAX_LIVE_AGE_MS) return false;
  if (!isMuted(mutedUntil, now)) return true;
  return mentionsUser(message.content, myId);
};

/**
 * Show an in-app banner (and sound) for a live message while the tab is visible, unless that
 * chat is the one on screen. Same rules as a system notification otherwise.
 */
export const shouldBanner = (input: NotifyInput & { inView: boolean }): boolean =>
  !input.tabHidden && !input.inView && shouldNotify({ ...input, tabHidden: true });

/** True if enough time has passed since the last sound (lastPlayedAt is null if never). */
export const canPlaySound = (
  lastPlayedAt: number | null,
  now: number,
  minGapMs: number = SOUND_MIN_GAP_MS,
): boolean => lastPlayedAt === null || now - lastPlayedAt >= minGapMs;

const MAX_EXCERPT = 100;

/** A short line for the notification body. */
export const excerptOf = (content: MessageContent): string => {
  switch (content.type) {
    case 'text':
      return content.text.length > MAX_EXCERPT
        ? `${content.text.slice(0, MAX_EXCERPT - 1)}…`
        : content.text;
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return 'Voice message';
    case 'file':
      return 'File';
    case 'gif':
      return 'GIF';
    case 'sticker':
      return 'Sticker';
    case 'poll':
      return 'Poll';
    default:
      return 'New message';
  }
};
