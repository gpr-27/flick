// The words of a notification, shared by the worker (push text) and the API (notification centre),
// so a push and the centre never describe the same message differently.

const PREVIEW_MAX = 100;

/** The first ~100 characters on one line, with an ellipsis when cut. */
export function shortText(text: string, max = PREVIEW_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1).trimEnd()}…`;
}

/** What a message that is not plain text is called, as a noun and as a phrase. */
const KINDS: Record<string, { noun: string; phrase: string }> = {
  image: { noun: 'Photo', phrase: 'a photo' },
  video: { noun: 'Video', phrase: 'a video' },
  voice: { noun: 'Voice message', phrase: 'a voice message' },
  file: { noun: 'File', phrase: 'a file' },
  gif: { noun: 'GIF', phrase: 'a GIF' },
  sticker: { noun: 'Sticker', phrase: 'a sticker' },
  poll: { noun: 'Poll', phrase: 'a poll' },
};

/** The album fields of an image or video message (contracts: AlbumMeta). */
export interface AlbumInfo {
  index: number;
  count: number;
  videos?: number | undefined;
}

/** Reads `content.album` defensively from the stored jsonb; null when the message is not in an album. */
export function albumOf(content: unknown): AlbumInfo | null {
  if (typeof content !== 'object' || content === null) return null;
  const a = (content as { album?: unknown }).album;
  if (typeof a !== 'object' || a === null) return null;
  const { index, count, videos } = a as Record<string, unknown>;
  if (typeof index !== 'number' || typeof count !== 'number' || count < 2) return null;
  return { index, count, ...(typeof videos === 'number' ? { videos } : {}) };
}

/**
 * An album of photos and videos is one alert, sent for its first item (the others are silent).
 * True when this message is one of the silent ones.
 */
export const isSilentAlbumItem = (album: AlbumInfo | null): boolean =>
  album !== null && album.index > 0;

/** "4 photos", "3 photos and 2 videos". */
export function albumText(album: { count: number; videos?: number | undefined }): string {
  const videos = Math.min(album.count, album.videos ?? 0);
  const photos = album.count - videos;
  const part = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
  if (videos === 0) return part(photos, 'photo');
  if (photos === 0) return part(videos, 'video');
  return `${part(photos, 'photo')} and ${part(videos, 'video')}`;
}

export interface PreviewInput {
  type: string;
  bodyText: string | null;
  viewOnce?: boolean;
  /** Set for an album item: the one alert says "4 photos" instead of "a photo". */
  album?: AlbumInfo | null | undefined;
}

/**
 * The line shown under the sender: the text, or a caption, or "Sent you a photo". A view-once
 * message never shows its caption, and a message with no words falls back to its kind.
 */
export function previewOf({ type, bodyText, viewOnce, album }: PreviewInput): string {
  const text = bodyText?.trim() ?? '';
  if (album && !viewOnce && (type === 'image' || type === 'video')) {
    const label = albumText(album);
    return text ? `${label}: ${shortText(text, 80)}` : `Sent you ${label}`;
  }
  if (type === 'text') return text ? shortText(text) : 'Sent you a message';
  const kind = KINDS[type] ?? { noun: 'Message', phrase: 'a message' };
  if (viewOnce) return `Sent you a view-once ${kind.noun.toLowerCase()}`;
  // A caption reads better than a bare label: "Photo: sunset at the beach".
  if (text) return `${kind.noun}: ${shortText(text, 80)}`;
  return `Sent you ${kind.phrase}`;
}

/** The notification title: the sender, and for a group "Sender in Group". */
export function titleOf(senderName: string, groupName: string | null): string {
  const sender = shortText(senderName, 40) || 'Someone';
  return groupName ? `${sender} in ${shortText(groupName, 40)}` : sender;
}

/** What shows instead of the message when the person turned message previews off. */
export const HIDDEN_PREVIEW = 'New message';
