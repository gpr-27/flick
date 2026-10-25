// The offline outbox: messages the user wrote that the server has not accepted yet.
//
// They are persisted in IndexedDB the moment they are written, so a reload, a crash or a long
// offline stretch loses nothing. They are (re)sent only when the connection is `ready`, meaning
// authenticated AND synced: sending before the catch-up sync would let our own message race
// ahead of messages we have not seen yet. Every send, resend and Retry reuses the same
// client_message_id (see outboxMachine.ts), which is what makes resending safe.
import { create } from 'zustand';
import type { MessageAccepted, SendMessageInput } from '@chat/contracts';
import { logger } from '@/lib/logger';
import { randomId } from '@/lib/ids';
import { openKv, type KvStore } from '@/lib/idb';
import { getTransport } from '@/lib/services';
import { useChatStore } from '../useChatStore';
import { reduceOutbox, type OutboxEvent, type OutboxItem } from './outboxMachine';

let kv: KvStore<OutboxItem> | null = null;
const storage = (): KvStore<OutboxItem> => (kv ??= openKv<OutboxItem>('flick', 'outbox'));
/** Tests swap in an in-memory store. */
export const configureOutboxStorage = (store: KvStore<OutboxItem> | null): void => {
  kv = store;
};

/** Messages written to the socket whose answer has not come back yet. Not persisted. */
const inflight = new Set<string>();

interface OutboxState {
  items: OutboxItem[];
  /** Connected and synced: safe to send. */
  ready: boolean;

  /** Load this user's unsent messages after sign-in. */
  hydrate: (userId: string) => Promise<void>;
  /** Queue a message. Returns its client_message_id. */
  send: (userId: string, conversationId: string, content: OutboxItem['content']) => string;
  retry: (clientMessageId: string) => void;
  discard: (clientMessageId: string) => void;
  setReady: (ready: boolean) => void;
  handleAccepted: (accepted: MessageAccepted) => void;
  handleFailed: (failure: {
    client_message_id: string;
    error: { code: string; message: string; retryable: boolean };
  }) => void;
  /** Sign-out: drop everything, including what is stored. */
  clear: () => Promise<void>;
}

export const useOutboxStore = create<OutboxState>()((set, get) => {
  const persist = (event: OutboxEvent, next: readonly OutboxItem[]): void => {
    const id = event.type === 'queued' ? event.item.client_message_id : event.client_message_id;
    const item = next.find((i) => i.client_message_id === id);
    const write = item ? storage().put(id, item) : storage().delete(id);
    write.catch((error: unknown) => {
      logger.warn('Could not save the outbox:', error);
    });
  };

  const dispatch = (event: OutboxEvent): void => {
    const next = reduceOutbox(get().items, event);
    set({ items: next });
    persist(event, next);
  };

  /**
   * Write the pending messages to the socket, oldest first, ONE AT A TIME per conversation: the
   * next one goes out only when the server has answered the one before it. Written all at once,
   * a queue built up offline reached the server together, the server stored them in whatever
   * order its handlers finished, and the receiver saw "1, 2, 3" as "2, 3, 1".
   */
  const flush = (): void => {
    if (!get().ready) return;
    const busy = new Set(
      get()
        .items.filter((i) => inflight.has(i.client_message_id))
        .map((i) => i.conversation_id),
    );
    const pending = get()
      .items.filter((i) => i.status === 'pending' && !inflight.has(i.client_message_id))
      .sort((a, b) => a.created_at - b.created_at);
    for (const item of pending) {
      if (busy.has(item.conversation_id)) continue; // wait for the answer to the one ahead
      if (getTransport().state !== 'connected') return; // setReady(false) is on its way
      busy.add(item.conversation_id);
      inflight.add(item.client_message_id);
      // No answer within the transport's timeout is a retryable failure (Retry button).
      void getTransport()
        .request('send_message', {
          conversation_id: item.conversation_id,
          client_message_id: item.client_message_id,
          content: item.content,
        })
        .then((ack) => {
          if (ack.ok) {
            get().handleAccepted(ack.data);
            flush(); // the next message of that chat may go now
          } else if (ack.error.code !== 'OFFLINE' && inflight.has(item.client_message_id)) {
            // OFFLINE: the message stays pending and goes out again when we are ready.
            get().handleFailed({ client_message_id: item.client_message_id, error: ack.error });
            flush();
          } else {
            inflight.delete(item.client_message_id);
          }
        });
    }
  };

  return {
    items: [],
    ready: false,

    hydrate: async (userId) => {
      try {
        const stored = await storage().getAll();
        set({ items: stored.filter((i) => i.user_id === userId) });
        flush();
      } catch (error) {
        logger.warn('Could not read the outbox:', error);
      }
    },

    send: (userId, conversationId, content) => {
      const clientMessageId = randomId();
      dispatch({
        type: 'queued',
        item: {
          client_message_id: clientMessageId,
          conversation_id: conversationId,
          user_id: userId,
          content,
          created_at: Date.now(),
        },
      });
      flush();
      return clientMessageId;
    },

    retry: (clientMessageId) => {
      dispatch({ type: 'retry', client_message_id: clientMessageId });
      flush();
    },

    discard: (clientMessageId) => {
      inflight.delete(clientMessageId);
      dispatch({ type: 'discard', client_message_id: clientMessageId });
    },

    setReady: (ready) => {
      set({ ready });
      if (ready) flush();
      else {
        // The answers to what we sent will not come on a dead socket. The messages stay pending
        // and go out again, with the same ids, when we are ready.
        inflight.clear();
      }
    },

    handleAccepted: (accepted) => {
      inflight.delete(accepted.client_message_id);
      const item = get().items.find((i) => i.client_message_id === accepted.client_message_id);
      if (!item) return;
      // Hand the message to the thread first so the bubble never disappears between the two.
      useChatStore.getState().messageAccepted(item, accepted);
      dispatch({ type: 'accepted', client_message_id: accepted.client_message_id });
    },

    handleFailed: ({ client_message_id, error }) => {
      inflight.delete(client_message_id);
      dispatch({ type: 'failed', client_message_id, error });
    },

    clear: async () => {
      inflight.clear();
      set({ items: [], ready: false });
      try {
        await storage().clear();
      } catch (error) {
        logger.warn('Could not clear the outbox:', error);
      }
    },
  };
});

/** Send a message from the UI. */
export const sendMessage = (
  userId: string,
  conversationId: string,
  content: SendMessageInput['content'],
): string => useOutboxStore.getState().send(userId, conversationId, content);
