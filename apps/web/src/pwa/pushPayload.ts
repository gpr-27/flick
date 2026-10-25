// What the worker sends in a push (apps/worker/src/push-payload.ts) and how the service worker
// turns it into a notification. Pure, so it is unit-tested without a browser.
//
// Rule for the service worker: EVERY push shows a notification. Browsers take away the permission
// of a site that receives pushes without showing anything, and iOS does it almost at once.

export interface PushPayload {
  title: string;
  body: string;
  conversation_id: string;
  message_id: string;
  /** The message's number in its chat; lets a tap scroll to it. */
  seq?: number;
  /** A group chat: its notifications are summarised under the group's name. */
  group?: boolean;
  sender_name?: string;
  group_name?: string;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Returns null for anything that is not a well-formed payload (the SW then shows a generic one). */
export const parsePushPayload = (raw: unknown): PushPayload | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (!isString(p.title) || !isString(p.conversation_id) || !isString(p.message_id)) return null;
  return {
    title: p.title,
    body: typeof p.body === 'string' ? p.body : '',
    conversation_id: p.conversation_id,
    message_id: p.message_id,
    ...(typeof p.seq === 'number' && Number.isInteger(p.seq) ? { seq: p.seq } : {}),
    ...(p.group === true ? { group: true } : {}),
    ...(isString(p.sender_name) ? { sender_name: p.sender_name } : {}),
    ...(isString(p.group_name) ? { group_name: p.group_name } : {}),
  };
};

/** "Send me a test notification" (type "test"): any title and body, nothing to open. */
export interface TestPush {
  title: string;
  body: string;
}
export const parseTestPush = (raw: unknown): TestPush | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p.type !== 'test') return null;
  return {
    title: isString(p.title) ? p.title : 'Flick test notification',
    body: typeof p.body === 'string' ? p.body : 'It works!',
  };
};

/** The URL the app understands: it opens this conversation after loading. */
export const conversationUrl = (conversationId: string): string =>
  `/?c=${encodeURIComponent(conversationId)}`;

/** Opens the chat scrolled to one message (`s` is its seq, needed to find it in the history). */
export const messageUrl = (conversationId: string, messageId: string, seq?: number): string =>
  `${conversationUrl(conversationId)}&m=${encodeURIComponent(messageId)}${
    seq === undefined ? '' : `&s=${seq}`
  }`;

/** One notification per chat. */
export const chatTag = (conversationId: string): string => `chat:${conversationId}`;

/** What a message notification carries, so a later push of the same chat can add to it. */
export interface MessageNotificationData {
  kind: 'message';
  url: string;
  conversation_id: string;
  message_id: string;
  /** How many messages this notification stands for. */
  count: number;
  /** Message ids already counted (a retried push must not count twice). */
  ids: string[];
  /** The latest few "Name: text" lines, newest last. */
  lines: string[];
}

export interface ShownNotification {
  title: string;
  options: {
    body: string;
    tag: string;
    icon: string;
    badge: string;
    renotify?: boolean;
    timestamp?: number;
    data: MessageNotificationData | { kind: 'generic' | 'test'; url: string };
  };
}

const ICONS = { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
const MAX_IDS = 30;
const MAX_LINES = 5;

/** What the open notification of the same chat said (read from its `data`), or null. */
export const previousOf = (data: unknown): MessageNotificationData | null => {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Partial<MessageNotificationData>;
  if (d.kind !== 'message' || !Array.isArray(d.ids) || typeof d.count !== 'number') return null;
  return {
    kind: 'message',
    url: d.url ?? '/',
    conversation_id: d.conversation_id ?? '',
    message_id: d.message_id ?? '',
    count: d.count,
    ids: d.ids.filter((x): x is string => typeof x === 'string'),
    lines: Array.isArray(d.lines) ? d.lines.filter((x): x is string => typeof x === 'string') : [],
  };
};

/**
 * One notification per chat: its `tag` is the chat, and `renotify` makes the phone buzz again when
 * a new message replaces the old text. The second message turns the text into "Bob: 2 new
 * messages", so a busy chat does not fill the shade. A message counted already (a retried push) is
 * shown again as it was, not counted twice.
 */
export const toNotification = (
  payload: PushPayload | null,
  previous: MessageNotificationData | null = null,
): ShownNotification => {
  if (!payload) {
    return {
      title: 'Flick',
      options: {
        body: 'You have a new message',
        tag: 'flick-generic',
        ...ICONS,
        data: { kind: 'generic', url: '/' },
      },
    };
  }
  const already = previous?.ids.includes(payload.message_id) ?? false;
  const count = previous ? (already ? previous.count : previous.count + 1) : 1;
  const ids =
    already || !previous
      ? (previous?.ids ?? [payload.message_id])
      : [...previous.ids, payload.message_id];
  const line = payload.sender_name ? `${payload.sender_name}: ${payload.body}` : payload.body;
  const lines =
    already && previous ? previous.lines : [...(previous?.lines ?? []), line].slice(-MAX_LINES);
  const many = count > 1;
  // In a group the summary carries the group's name; in a 1:1 chat, the person's.
  const title = many
    ? (payload.group ? payload.group_name : payload.sender_name) || payload.title
    : payload.title;
  return {
    title,
    options: {
      body: many ? `${count} new messages` : payload.body,
      tag: chatTag(payload.conversation_id),
      renotify: true,
      ...ICONS,
      data: {
        kind: 'message',
        url: messageUrl(payload.conversation_id, payload.message_id, payload.seq),
        conversation_id: payload.conversation_id,
        message_id: payload.message_id,
        count,
        ids: ids.slice(-MAX_IDS),
        lines,
      },
    },
  };
};

export const testNotification = (p: TestPush): ShownNotification => ({
  title: p.title,
  options: { body: p.body, tag: 'flick-test', ...ICONS, data: { kind: 'test', url: '/settings' } },
});
