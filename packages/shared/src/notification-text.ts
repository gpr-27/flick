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

export interface PreviewInput {
  type: string;
  bodyText: string | null;
  viewOnce?: boolean;
}

/**
 * The line shown under the sender: the text, or a caption, or "Sent you a photo". A view-once
 * message never shows its caption, and a message with no words falls back to its kind.
 */
export function previewOf({ type, bodyText, viewOnce }: PreviewInput): string {
  const text = bodyText?.trim() ?? '';
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
