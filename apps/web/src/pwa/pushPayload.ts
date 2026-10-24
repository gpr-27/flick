// What the worker sends in a push (apps/worker/src/web-push-provider.ts) and how the service
// worker turns it into a notification. Pure, so it is unit-tested without a browser.

export interface PushPayload {
  title: string;
  body: string;
  conversation_id: string;
  message_id: string;
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
  };
};

/** The URL the app understands: it opens this conversation after loading. */
export const conversationUrl = (conversationId: string): string =>
  `/?c=${encodeURIComponent(conversationId)}`;

export interface ShownNotification {
  title: string;
  options: { body: string; tag: string; icon: string; badge: string; data: { url: string } };
}

/**
 * `tag` is the message id: if the worker retries and the push arrives twice, the second
 * notification replaces the first instead of showing a duplicate.
 */
export const toNotification = (payload: PushPayload | null): ShownNotification => {
  if (!payload) {
    return {
      title: 'Flick',
      options: {
        body: 'You have a new message',
        tag: 'flick-generic',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/' },
      },
    };
  }
  return {
    title: payload.title,
    options: {
      body: payload.body,
      tag: payload.message_id,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: conversationUrl(payload.conversation_id) },
    },
  };
};
