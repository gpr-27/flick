// Pin, star and forward. None of these take a seq on the server, so they do not arrive through
// the sync engine: we call the REST endpoint and update local state from the answer.
import { create } from 'zustand';
import { ENDPOINTS, type MessageContent, type MessageRecord } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';
import { useChatStore } from '../chat/useChatStore';
import { sendMessage } from '../chat/outbox/useOutboxStore';

// ── pinned messages ────────────────────────────────────────────────────────

interface PinsState {
  /** Newest pin first (the server's order). Loaded when a chat opens. */
  byConversation: Record<string, MessageRecord[]>;
  load: (conversationId: string) => Promise<void>;
  toggle: (message: MessageRecord) => Promise<void>;
  /** Another member (or another device of ours) pinned or unpinned a message. */
  applyChange: (change: { conversation_id: string; message_id: string; pinned: boolean }) => void;
}

export const usePinsStore = create<PinsState>()((set, get) => ({
  byConversation: {},

  load: async (conversationId) => {
    try {
      const { items } = await getApi().call(ENDPOINTS.messages.pins, {
        params: { conversation_id: conversationId },
      });
      set((s) => ({ byConversation: { ...s.byConversation, [conversationId]: items } }));
    } catch (error) {
      logger.warn('Could not load pinned messages:', error);
    }
  },

  applyChange: ({ conversation_id, message_id, pinned }) => {
    const known = get().byConversation[conversation_id];
    if (!pinned) {
      if (known)
        set((s) => ({
          byConversation: {
            ...s.byConversation,
            [conversation_id]: known.filter((m) => m.message_id !== message_id),
          },
        }));
      return;
    }
    // A new pin: reload, because the record and the order come from the server. A chat whose
    // pins were never loaded loads them when it opens.
    if (known) void get().load(conversation_id);
  },

  toggle: async (message) => {
    const id = message.conversation_id;
    const pinned = (get().byConversation[id] ?? []).some(
      (m) => m.message_id === message.message_id,
    );
    const params = { conversation_id: id, message_id: message.message_id };
    try {
      if (pinned) await getApi().call(ENDPOINTS.messages.unpin, { params });
      else
        await getApi().call(ENDPOINTS.messages.pin, {
          params: { conversation_id: id },
          body: { message_id: message.message_id },
        });
      // Reload instead of patching: the server decides the order, and another member may have
      // pinned something in the meantime.
      await get().load(id);
    } catch (error) {
      notify.error(getErrorMessage(error, pinned ? "Couldn't unpin." : "Couldn't pin."));
    }
  },
}));

// ── starred messages ───────────────────────────────────────────────────────

export const toggleStar = async (message: MessageRecord): Promise<void> => {
  const next = !message.starred;
  const params = { conversation_id: message.conversation_id, message_id: message.message_id };
  try {
    if (next) await getApi().call(ENDPOINTS.messages.star, { params });
    else await getApi().call(ENDPOINTS.messages.unstar, { params });
    useChatStore.setState((s) => {
      const thread = s.threads[message.conversation_id];
      if (!thread) return s;
      const messages = thread.messages.map((m) =>
        m.message_id === message.message_id ? { ...m, starred: next } : m,
      );
      return { threads: { ...s.threads, [message.conversation_id]: { ...thread, messages } } };
    });
  } catch (error) {
    notify.error(getErrorMessage(error, "Couldn't update the star."));
  }
};

// ── forward ────────────────────────────────────────────────────────────────

/** Types that make sense in another chat. Polls, votes, system and call lines stay where they are. */
const FORWARDABLE = new Set(['text', 'image', 'video', 'file', 'voice', 'gif', 'sticker']);

/**
 * The content to send to another chat: the same content marked `forwarded`, without anything that
 * only means something in the original chat (reply link, mentions, view-once).
 */
export const forwardContent = (content: MessageContent | null): MessageContent | null => {
  if (!content || !FORWARDABLE.has(content.type) || content.view_once) return null;
  const { reply_to: _reply, mentions: _mentions, view_once: _once, ...rest } = content;
  return { ...rest, forwarded: true };
};

/** A normal send to each chat (the outbox gives every copy its own client_message_id). */
export const forwardMessage = (
  userId: string,
  message: MessageRecord,
  conversationIds: readonly string[],
): boolean => {
  const content = forwardContent(message.content);
  if (!content) return false;
  for (const id of conversationIds) sendMessage(userId, id, content);
  return true;
};
