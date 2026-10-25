const CHAT_LINK = /^\/\?c=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The chat id in an in-app link like `/?c=<id>` (Flick's reminder messages use it), or null.
 * Only this exact shape counts, so it can open a chat the person is already in and nothing else.
 */
export const chatLinkId = (raw: string): string | null => CHAT_LINK.exec(raw.trim())?.[1] ?? null;
