import { useEffect, useState } from 'react';
import type { ConversationSummary, MessageRecord } from '@chat/contracts';
import { isFlickBot, isFlickChat } from './isFlickBot';

/** How long "Flick is thinking…" may show before we give up waiting for an answer. */
export const THINKING_MS = 40_000;

const MENTION = /(^|[^\w])@flick\b/i;

/**
 * The message of mine that Flick still owes an answer to, or null. In the bot chat every message
 * of mine counts; in a group only an @flick mention or a reply to a bot message does. A bot
 * message after it means it was answered.
 */
export const pendingFlickMessage = (
  messages: readonly MessageRecord[],
  myId: string,
  conversation: Pick<ConversationSummary, 'type' | 'peer'>,
): MessageRecord | null => {
  const botChat = isFlickChat(conversation);
  const byId = new Map(messages.map((m) => [m.message_id, m]));
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m?.content) continue;
    if (isFlickBot(m.sender_user_id, null)) return null;
    if (m.sender_user_id !== myId || m.content.type === 'system') continue;
    if (botChat) return m;
    const replied = m.content.reply_to ? byId.get(m.content.reply_to) : undefined;
    const asksFlick =
      (m.content.type === 'text' && MENTION.test(m.content.text)) ||
      (replied !== undefined && isFlickBot(replied.sender_user_id, null));
    if (asksFlick) return m;
  }
  return null;
};

/** True while Flick is (probably) working on an answer, for at most THINKING_MS. */
export const useFlickThinking = (
  messages: readonly MessageRecord[],
  myId: string,
  conversation: Pick<ConversationSummary, 'type' | 'peer'>,
): boolean => {
  const pending = pendingFlickMessage(messages, myId, conversation);
  const sentAt = pending ? Date.parse(pending.created_at) : 0;
  const key = pending ? pending.message_id : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!key) return;
    const left = sentAt + THINKING_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => {
      setNow(Date.now());
    }, left + 50);
    return () => {
      clearTimeout(timer);
    };
  }, [key, sentAt]);
  return pending !== null && now - sentAt < THINKING_MS;
};
