// Chat state: the conversation list, each open thread, receipts, typing and presence.
//
// Server messages live here, sorted by seq. Messages the user is still sending live in the
// outbox store; the screen shows both (see threadRows.ts). Events arrive through the sync
// engine (sync/syncEngine.ts), which decides what to apply and in what order; this store only
// knows how to store one event.
import { create } from 'zustand';
import {
  ENDPOINTS,
  TYPING,
  type ConversationSummary,
  type MessageAccepted,
  type MessageRecord,
  type SyncEvent,
  type UserSummary,
} from '@chat/contracts';
import type { z } from 'zod';
import type { Member as MemberSchema, UpdateConversationRequest } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';
import { getApi, getTransport } from '@/lib/services';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { notifyIncoming } from '@/features/notifications/notifyIncoming';
import type { OutboxItem } from './outbox/outboxMachine';
import { createSyncEngine, type SyncEngine } from './sync/syncEngine';
import {
  applyEventToSummary,
  applyEventToThread,
  insertMessage,
  mergeHistory,
  withReaction,
  withoutReaction,
} from './threadOps';

export type Member = z.infer<typeof MemberSchema>;
export type Activity = 'typing' | 'recording_voice' | 'recording_video' | 'uploading';

export interface Thread {
  /** Sorted by seq. */
  messages: MessageRecord[];
  status: 'loading' | 'ready' | 'error';
  hasOlder: boolean;
  loadingOlder: boolean;
  error: string | null;
}

interface Cursors {
  delivered_seq: number;
  read_seq: number;
}

const HISTORY_PAGE = 50;
const MAX_LIST_PAGES = 10;
const MAX_MEMBER_PAGES = 11; // 1 024 members at 100 per page

interface ChatState {
  conversations: Record<string, ConversationSummary>;
  listStatus: 'idle' | 'loading' | 'ready' | 'error';
  listError: string | null;
  threads: Record<string, Thread>;
  members: Record<string, Member[]>;
  users: Record<string, UserSummary>;
  /** Other members' delivered/read cursors per conversation; ticks are derived from them. */
  receipts: Record<string, Record<string, Cursors>>;
  typing: Record<string, Record<string, Activity>>;
  presence: Record<string, { online: boolean; last_seen_at: string | null }>;
  selectedId: string | null;
  /** The open conversation is on screen and the window is focused: incoming messages count as read. */
  inView: boolean;
  replyingTo: MessageRecord | null;
  editing: MessageRecord | null;

  loadConversations: () => Promise<void>;
  /** After a reconnect: pick up new conversations and settings changes without touching messages. */
  refreshConversations: () => Promise<void>;
  select: (id: string | null) => void;
  setInView: (inView: boolean) => void;
  loadOlder: (id: string) => Promise<void>;
  retryThread: (id: string) => void;
  setReplyingTo: (message: MessageRecord | null) => void;
  setEditing: (message: MessageRecord | null) => void;

  // events
  applyEvent: (event: SyncEvent) => void;
  messageAccepted: (item: OutboxItem, accepted: MessageAccepted) => void;
  receiptUpdate: (p: {
    conversation_id: string;
    user_id: string;
    delivered_seq?: number | undefined;
    read_seq?: number | undefined;
  }) => void;
  setActivity: (conversationId: string, userId: string, activity: Activity | null) => void;
  presenceUpdate: (userId: string, online: boolean, lastSeenAt: string | null) => void;
  conversationUpdated: (conversationId: string, summary: ConversationSummary | null) => void;
  removeConversations: (ids: string[]) => void;
  clearTyping: () => void;

  // user actions
  markRead: (conversationId: string) => void;
  notifyTyping: (conversationId: string) => void;
  notifyStopTyping: (conversationId: string) => void;
  editMessage: (message: MessageRecord, text: string) => Promise<void>;
  deleteMessage: (message: MessageRecord, scope: 'me' | 'everyone') => Promise<void>;
  react: (message: MessageRecord, emoji: string) => Promise<void>;
  openDirect: (userId: string) => Promise<void>;
  createGroup: (title: string, memberIds: string[]) => Promise<boolean>;
  loadMembers: (conversationId: string) => Promise<void>;
  addMembers: (conversationId: string, userIds: string[]) => Promise<void>;
  removeMember: (conversationId: string, userId: string) => Promise<void>;
  setRole: (conversationId: string, userId: string, role: Member['role']) => Promise<void>;
  renameGroup: (conversationId: string, title: string) => Promise<void>;
  /** Name, description, photo (an uploaded attachment id) and the group switches, in one PATCH. */
  updateGroup: (
    conversationId: string,
    patch: z.infer<typeof UpdateConversationRequest>,
  ) => Promise<boolean>;
  leave: (conversationId: string) => Promise<void>;
  reset: () => void;
}

const myId = (): string | undefined => useSessionStore.getState().user?.id;

const initial = {
  conversations: {},
  listStatus: 'idle',
  listError: null,
  threads: {},
  members: {},
  users: {},
  receipts: {},
  typing: {},
  presence: {},
  selectedId: null,
  inView: false,
  replyingTo: null,
  editing: null,
} satisfies Partial<ChatState>;

const rememberUsers = (
  users: Record<string, UserSummary>,
  list: readonly (UserSummary | null)[],
): Record<string, UserSummary> => {
  const next = { ...users };
  for (const u of list) if (u) next[u.id] = u;
  return next;
};

/** Typing indicators heal themselves: a lost typing_stop is cleared after the TTL (protocol §6). */
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastTypingSent = new Map<string, number>();
const fetchingUnknown = new Set<string>();

export const useChatStore = create<ChatState>()((set, get) => {
  const patchConversation = (
    id: string,
    change: (c: ConversationSummary) => ConversationSummary,
  ): void => {
    set((s) => {
      const current = s.conversations[id];
      return current ? { conversations: { ...s.conversations, [id]: change(current) } } : s;
    });
  };

  const patchThread = (
    id: string,
    change: (messages: MessageRecord[]) => MessageRecord[],
  ): void => {
    set((s) => {
      const thread = s.threads[id];
      return thread
        ? { threads: { ...s.threads, [id]: { ...thread, messages: change(thread.messages) } } }
        : s;
    });
  };

  const addConversations = (list: readonly ConversationSummary[]): void => {
    for (const c of list) syncEngine.baseline(c.id, c.last_seq);
    // A conversation that appears while we are connected (someone's first message) is delivered
    // now; when we are not connected yet, start() reports it on connect.
    syncEngine.acknowledge(list.map((c) => c.id));
    set((s) => ({
      conversations: { ...s.conversations, ...Object.fromEntries(list.map((c) => [c.id, c])) },
      users: rememberUsers(
        s.users,
        list.map((c) => c.peer),
      ),
    }));
  };

  const fetchHistory = async (id: string, beforeSeq?: number): Promise<void> => {
    const page = await getApi().call(ENDPOINTS.messages.history, {
      params: { conversation_id: id },
      query: { limit: HISTORY_PAGE, ...(beforeSeq ? { before_seq: beforeSeq } : {}) },
    });
    set((s) => {
      const thread = s.threads[id];
      return {
        threads: {
          ...s.threads,
          [id]: {
            messages: mergeHistory(thread?.messages ?? [], page.items),
            status: 'ready',
            hasOlder: page.next_cursor !== null,
            loadingOlder: false,
            error: null,
          },
        },
      };
    });
  };

  return {
    ...initial,

    loadConversations: async () => {
      set({ listStatus: 'loading', listError: null });
      try {
        // "all" leaves out archived chats, so they are fetched separately; the Archived section
        // and the pin/filter logic read them from the same store.
        const all: ConversationSummary[] = [];
        for (const filter of ['all', 'archived'] as const) {
          let cursor: string | undefined;
          for (let page = 0; page < MAX_LIST_PAGES; page++) {
            const res = await getApi().call(ENDPOINTS.conversations.list, {
              query: { filter, ...(cursor ? { cursor } : {}) },
            });
            all.push(...res.items);
            if (!res.next_cursor) break;
            cursor = res.next_cursor;
          }
        }
        addConversations(all);
        set({ listStatus: 'ready' });
      } catch (error) {
        logger.warn('Could not load conversations:', error);
        set({
          listStatus: 'error',
          listError: getErrorMessage(error, "Couldn't load your chats."),
        });
      }
    },

    refreshConversations: async () => {
      try {
        const res = await getApi().call(ENDPOINTS.conversations.list, { query: { filter: 'all' } });
        const known = get().conversations;
        const fresh = res.items.filter((c) => !known[c.id]);
        addConversations(fresh);
        // Known conversations keep what events built (last message, unread); only settings change.
        set((s) => ({
          conversations: Object.fromEntries(
            Object.entries(s.conversations).map(([id, local]) => {
              const server = res.items.find((c) => c.id === id);
              return [
                id,
                server
                  ? {
                      ...server,
                      last_seq: local.last_seq,
                      last_message: local.last_message,
                      read_seq: local.read_seq,
                      unread_count: local.unread_count,
                    }
                  : local,
              ];
            }),
          ),
        }));
      } catch (error) {
        logger.warn('Could not refresh conversations:', error);
      }
    },

    select: (id) => {
      set({ selectedId: id, replyingTo: null, editing: null });
      if (id && !get().threads[id]) {
        set((s) => ({
          threads: {
            ...s.threads,
            [id]: {
              messages: [],
              status: 'loading',
              hasOlder: false,
              loadingOlder: false,
              error: null,
            },
          },
        }));
        get().retryThread(id);
      }
    },

    retryThread: (id) => {
      set((s) => {
        const thread = s.threads[id];
        return thread
          ? { threads: { ...s.threads, [id]: { ...thread, status: 'loading', error: null } } }
          : s;
      });
      void fetchHistory(id).catch((error: unknown) => {
        set((s) => {
          const thread = s.threads[id];
          return thread
            ? {
                threads: {
                  ...s.threads,
                  [id]: {
                    ...thread,
                    status: 'error',
                    error: getErrorMessage(error, "Couldn't load messages."),
                  },
                },
              }
            : s;
        });
      });
    },

    setInView: (inView) => {
      if (get().inView !== inView) set({ inView });
    },

    loadOlder: async (id) => {
      const thread = get().threads[id];
      const oldest = thread?.messages[0];
      if (!thread || !oldest || !thread.hasOlder || thread.loadingOlder) return;
      set((s) => ({ threads: { ...s.threads, [id]: { ...thread, loadingOlder: true } } }));
      try {
        await fetchHistory(id, oldest.seq);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't load earlier messages."));
        set((s) => {
          const t = s.threads[id];
          return t ? { threads: { ...s.threads, [id]: { ...t, loadingOlder: false } } } : s;
        });
      }
    },

    setReplyingTo: (message) => {
      set({ replyingTo: message, editing: null });
    },
    setEditing: (message) => {
      set({ editing: message, replyingTo: null });
    },

    // ── events ───────────────────────────────────────────────────────────

    applyEvent: (event) => {
      const me = myId();
      const conversationId =
        event.type === 'new_message'
          ? event.payload.message.conversation_id
          : event.payload.conversation_id;
      const s = get();
      patchThread(conversationId, (messages) => applyEventToThread(messages, event));
      const summary = s.conversations[conversationId];
      if (summary && me) {
        const inView = s.inView && s.selectedId === conversationId;
        patchConversation(conversationId, (c) =>
          applyEventToSummary(c, event, { myId: me, inView }),
        );
      }
      if (event.type === 'new_message') {
        // Someone who just sent a message is no longer typing.
        const sender = event.payload.message.sender_user_id;
        if (sender) get().setActivity(conversationId, sender, null);
        if (summary && me) {
          notifyIncoming(event.payload.message, {
            summary,
            myId: me,
            senderName:
              (sender && s.users[sender]?.display_name) || summary.peer?.display_name || 'Someone',
            open: () => {
              get().select(conversationId);
            },
          });
        }
      }
    },

    messageAccepted: (item, accepted) => {
      const me = myId();
      if (!me) return;
      // Build the record the server will also send us: either copy may arrive first, both end up
      // as the same message (insertMessage replaces by message_id).
      const record: MessageRecord = {
        message_id: accepted.message_id,
        conversation_id: accepted.conversation_id,
        seq: accepted.seq,
        sender_user_id: me,
        client_message_id: accepted.client_message_id,
        content: item.content,
        created_at: accepted.created_at,
        edited_at: null,
        deleted_at: null,
        expires_at: null,
        reactions: [],
        starred: false,
        viewed: false,
      };
      syncEngine.noteOwn(accepted.conversation_id, accepted.seq);
      patchThread(accepted.conversation_id, (messages) => insertMessage(messages, record));
      patchConversation(accepted.conversation_id, (c) =>
        accepted.seq >= c.last_seq ? { ...c, last_seq: accepted.seq, last_message: record } : c,
      );
    },

    receiptUpdate: ({ conversation_id, user_id, delivered_seq, read_seq }) => {
      if (user_id === myId()) {
        // Another of my devices read the chat.
        if (read_seq !== undefined) {
          patchConversation(conversation_id, (c) => ({
            ...c,
            read_seq: Math.max(c.read_seq, read_seq),
            unread_count: read_seq >= c.last_seq ? 0 : c.unread_count,
          }));
        }
        return;
      }
      set((s) => {
        const per = s.receipts[conversation_id] ?? {};
        const old = per[user_id] ?? { delivered_seq: 0, read_seq: 0 };
        // Cursors only move forward (the server stores them with GREATEST).
        const next = {
          delivered_seq: Math.max(old.delivered_seq, delivered_seq ?? 0),
          read_seq: Math.max(old.read_seq, read_seq ?? 0),
        };
        return { receipts: { ...s.receipts, [conversation_id]: { ...per, [user_id]: next } } };
      });
    },

    setActivity: (conversationId, userId, activity) => {
      const key = `${conversationId}:${userId}`;
      clearTimeout(typingTimers.get(key));
      typingTimers.delete(key);
      set((s) => {
        const { [userId]: previous, ...others } = s.typing[conversationId] ?? {};
        if (!activity && !previous) return s;
        const per = activity ? { ...others, [userId]: activity } : others;
        return { typing: { ...s.typing, [conversationId]: per } };
      });
      if (activity) {
        typingTimers.set(
          key,
          setTimeout(() => {
            get().setActivity(conversationId, userId, null);
          }, TYPING.TTL_MS),
        );
      }
    },

    presenceUpdate: (userId, online, lastSeenAt) => {
      set((s) => ({
        presence: { ...s.presence, [userId]: { online, last_seen_at: lastSeenAt } },
      }));
    },

    conversationUpdated: (conversationId, summary) => {
      if (!summary) {
        get().removeConversations([conversationId]);
        return;
      }
      const local = get().conversations[conversationId];
      if (!local) {
        addConversations([summary]);
        return;
      }
      // Settings, title, members and role come from the server; the message-derived fields stay.
      patchConversation(conversationId, (c) => ({
        ...summary,
        last_seq: c.last_seq,
        last_message: c.last_message,
        read_seq: c.read_seq,
        unread_count: c.unread_count,
      }));
      set((s) => ({ users: rememberUsers(s.users, [summary.peer]) }));
    },

    removeConversations: (ids) => {
      for (const id of ids) syncEngine.forget(id);
      set((s) => {
        const keep = <T>(record: Record<string, T>): Record<string, T> =>
          Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(id)));
        const conversations = keep(s.conversations);
        const threads = keep(s.threads);
        return {
          conversations,
          threads,
          selectedId: s.selectedId && ids.includes(s.selectedId) ? null : s.selectedId,
        };
      });
    },

    clearTyping: () => {
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
      set({ typing: {} });
    },

    // ── user actions ─────────────────────────────────────────────────────

    markRead: (conversationId) => {
      const c = get().conversations[conversationId];
      const seq = syncEngine.lastSeq(conversationId);
      if (!c || seq === undefined) return;
      if (seq <= c.read_seq && c.unread_count === 0) return;
      // If the socket is down the ack is not sent and nothing changes; the caller runs again
      // when the connection is back.
      if (getTransport().state !== 'connected') return;
      void getTransport().request('read_ack', { conversation_id: conversationId, seq });
      patchConversation(conversationId, (x) => ({
        ...x,
        read_seq: Math.max(x.read_seq, seq),
        unread_count: 0,
      }));
    },

    notifyTyping: (conversationId) => {
      const now = Date.now();
      if (now - (lastTypingSent.get(conversationId) ?? 0) < TYPING.THROTTLE_MS) return;
      if (getTransport().send('typing_start', { conversation_id: conversationId })) {
        lastTypingSent.set(conversationId, now);
      }
    },

    notifyStopTyping: (conversationId) => {
      if (!lastTypingSent.has(conversationId)) return;
      lastTypingSent.delete(conversationId);
      getTransport().send('typing_stop', { conversation_id: conversationId });
    },

    editMessage: async (message, text) => {
      set({ editing: null });
      try {
        // Only text and captions can be edited.
        const old = message.content;
        if (!old) return;
        const content = old.type === 'text' ? { ...old, text } : { ...old, caption: text };
        await getApi().call(ENDPOINTS.messages.edit, {
          params: { conversation_id: message.conversation_id, message_id: message.message_id },
          body: { content },
        });
        // The message_edited event (next seq) confirms it for everyone, including this tab.
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't edit the message."));
      }
    },

    deleteMessage: async (message, scope) => {
      try {
        await getApi().call(ENDPOINTS.messages.delete, {
          params: { conversation_id: message.conversation_id, message_id: message.message_id },
          query: { for: scope },
        });
        // "For me" has no event (nobody else is affected), so remove it here.
        if (scope === 'me') {
          patchThread(message.conversation_id, (ms) =>
            ms.filter((m) => m.message_id !== message.message_id),
          );
        }
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't delete the message."));
      }
    },

    react: async (message, emoji) => {
      const me = myId();
      if (!me) return;
      const had = message.reactions.some((r) => r.emoji === emoji && r.user_ids.includes(me));
      // Optimistic; the reaction event the server sends back applies the same change again.
      const setReactions = (reactions: MessageRecord['reactions']): void => {
        patchThread(message.conversation_id, (ms) =>
          ms.map((m) => (m.message_id === message.message_id ? { ...m, reactions } : m)),
        );
      };
      setReactions(
        had
          ? withoutReaction(message.reactions, me, emoji)
          : withReaction(message.reactions, me, emoji),
      );
      const params = { conversation_id: message.conversation_id, message_id: message.message_id };
      try {
        if (had) await getApi().call(ENDPOINTS.messages.unreact, { params });
        else await getApi().call(ENDPOINTS.messages.react, { params, body: { emoji } });
      } catch (error) {
        setReactions(message.reactions);
        notify.error(getErrorMessage(error, "Couldn't react."));
      }
    },

    openDirect: async (userId) => {
      try {
        const summary = await getApi().call(ENDPOINTS.conversations.createDirect, {
          body: { user_id: userId },
        });
        if (!get().conversations[summary.id]) addConversations([summary]);
        get().select(summary.id);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't start the chat."));
      }
    },

    createGroup: async (title, memberIds) => {
      try {
        const summary = await getApi().call(ENDPOINTS.conversations.createGroup, {
          body: { title, member_ids: memberIds },
        });
        if (!get().conversations[summary.id]) addConversations([summary]);
        get().select(summary.id);
        return true;
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't create the group."));
        return false;
      }
    },

    loadMembers: async (conversationId) => {
      try {
        const all: Member[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
          const res = await getApi().call(ENDPOINTS.conversations.members, {
            params: { conversation_id: conversationId },
            query: { limit: 100, ...(cursor ? { cursor } : {}) },
          });
          all.push(...res.items);
          if (!res.next_cursor) break;
          cursor = res.next_cursor;
        }
        set((s) => ({
          members: { ...s.members, [conversationId]: all },
          users: rememberUsers(
            s.users,
            all.map((m) => m.user),
          ),
        }));
      } catch (error) {
        logger.warn('Could not load members:', error);
      }
    },

    addMembers: async (conversationId, userIds) => {
      try {
        const res = await getApi().call(ENDPOINTS.conversations.addMembers, {
          params: { conversation_id: conversationId },
          body: { user_ids: userIds },
        });
        if (res.failed.length > 0) notify.error(`${res.failed.length} could not be added.`);
        await get().loadMembers(conversationId);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't add members."));
      }
    },

    removeMember: async (conversationId, userId) => {
      try {
        await getApi().call(ENDPOINTS.conversations.removeMember, {
          params: { conversation_id: conversationId, user_id: userId },
        });
        await get().loadMembers(conversationId);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't remove the member."));
      }
    },

    setRole: async (conversationId, userId, role) => {
      try {
        await getApi().call(ENDPOINTS.conversations.setRole, {
          params: { conversation_id: conversationId, user_id: userId },
          body: { role },
        });
        await get().loadMembers(conversationId);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't change the role."));
      }
    },

    renameGroup: async (conversationId, title) => {
      try {
        const summary = await getApi().call(ENDPOINTS.conversations.update, {
          params: { conversation_id: conversationId },
          body: { title },
        });
        get().conversationUpdated(conversationId, summary);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't rename the group."));
      }
    },

    updateGroup: async (conversationId, patch) => {
      try {
        const summary = await getApi().call(ENDPOINTS.conversations.update, {
          params: { conversation_id: conversationId },
          body: patch,
        });
        get().conversationUpdated(conversationId, summary);
        return true;
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't update the group."));
        return false;
      }
    },

    leave: async (conversationId) => {
      try {
        await getApi().call(ENDPOINTS.conversations.leave, {
          params: { conversation_id: conversationId },
        });
        get().removeConversations([conversationId]);
      } catch (error) {
        notify.error(getErrorMessage(error, "Couldn't leave the group."));
      }
    },

    reset: () => {
      for (const t of typingTimers.values()) clearTimeout(t);
      typingTimers.clear();
      lastTypingSent.clear();
      fetchingUnknown.clear();
      syncEngine.reset();
      set(initial);
    },
  };
});

// ── the sync engine, wired to this store ───────────────────────────────────

/** Fetch a conversation we have never seen (a chat someone started with us, found via an event). */
const fetchUnknownConversation = (id: string): void => {
  if (fetchingUnknown.has(id)) return;
  fetchingUnknown.add(id);
  void getApi()
    .call(ENDPOINTS.conversations.get, { params: { conversation_id: id } })
    .then((summary) => {
      // The summary already includes the event that made us look, so that event is not replayed.
      useChatStore.getState().conversationUpdated(id, summary);
    })
    .catch((error: unknown) => {
      logger.warn('Could not fetch an unknown conversation:', error);
    })
    .finally(() => {
      fetchingUnknown.delete(id);
    });
};

/** Hooks that need to know when a sync round ends (the outbox resends then). */
const syncedListeners = new Set<() => void>();
export const onSynced = (listener: () => void): (() => void) => {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
};

export const syncEngine: SyncEngine = createSyncEngine({
  sink: {
    apply: (event) => {
      useChatStore.getState().applyEvent(event);
    },
    remove: (ids) => {
      useChatStore.getState().removeConversations(ids);
    },
    unknownConversation: fetchUnknownConversation,
    synced: () => {
      for (const listener of [...syncedListeners]) listener();
    },
  },
  request: (type, payload) => getTransport().request(type, payload),
});

/** Display name for a user id, from whatever we have cached. */
export const userName = (users: Record<string, UserSummary>, id: string | null): string =>
  (id ? users[id]?.display_name : undefined) ?? 'Someone';
