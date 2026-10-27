// The decisions behind in-tab notifications, as plain functions so they are easy to test.
import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { albumLabel, type MessageContent, type MessageRecord } from '@chat/contracts';

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

/** True when a text message contains one of the person's keyword alerts (case-insensitive). */
export const hasKeyword = (content: MessageContent | null, keywords: readonly string[]): boolean =>
  content !== null &&
  content.type === 'text' &&
  keywords.some((k) => k !== '' && content.text.toLowerCase().includes(k.toLowerCase()));

export interface NotifyInput {
  message: MessageRecord;
  myId: string;
  mutedUntil: string | null;
  tabHidden: boolean;
  now: number;
  /** Keyword alerts: a match gets through mute like a mention does. */
  keywords?: readonly string[];
}

/** Notify for a live message from someone else while the tab is hidden. Mute is bypassed by a mention. */
export const shouldNotify = ({
  message,
  myId,
  mutedUntil,
  tabHidden,
  now,
  keywords = [],
}: NotifyInput): boolean => {
  if (!tabHidden) return false;
  if (message.sender_user_id === null || message.sender_user_id === myId) return false;
  if (message.deleted_at !== null || message.content === null) return false;
  if (QUIET_TYPES.has(message.content.type)) return false;
  if (now - Date.parse(message.created_at) > MAX_LIVE_AGE_MS) return false;
  if (!isMuted(mutedUntil, now)) return true;
  return mentionsUser(message.content, myId) || hasKeyword(message.content, keywords);
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
    case 'text': {
      const plain = stripMarkdown(content.text);
      return plain.length > MAX_EXCERPT ? `${plain.slice(0, MAX_EXCERPT - 1)}…` : plain;
    }
    case 'image':
      return content.album ? albumLabel(content.album) : 'Photo';
    case 'video':
      return content.album ? albumLabel(content.album) : 'Video';
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

/** True for the 2nd, 3rd... photo or video of an album: they stay silent after the first one. */
export const isSilentAlbumItem = (content: MessageContent | null): boolean =>
  (content?.type === 'image' || content?.type === 'video') && (content.album?.index ?? 0) > 0;
