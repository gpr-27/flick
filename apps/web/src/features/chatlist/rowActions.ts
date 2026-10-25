// What a chat row can do from the list (swipe buttons, the "⋮" menu, select mode). The UI calls
// these; each one is a plain function so the same action works from every place.
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi, getTransport } from '@/lib/services';
import { isFlickChat } from '@/features/ai/isFlickBot';
import { useMentions } from '@/features/notifications/mentions';
import { useChatStore } from '../chat/useChatStore';
import { conversationTitle } from '../chat/conversationView';
import { useDraftStore } from '../organise/drafts';
import { isMuted, updatePrefs } from '../organise/prefs';
import type { Side } from './swipeGesture';

export type ActionId = 'read' | 'pin' | 'mute' | 'archive' | 'delete';

export interface RowAction {
  id: ActionId;
  /** Short text for buttons and menu entries. */
  label: string;
  /** Names the chat, for screen readers: "Archive chat with Bob". */
  ariaLabel: string;
  destructive?: boolean;
}

/** The assistant chat and Saved messages cannot be removed, only emptied. */
export const isClearOnly = (c: ConversationSummary): boolean => c.is_saved || isFlickChat(c);

export const isUnread = (c: ConversationSummary): boolean =>
  c.unread_count > 0 || c.prefs.marked_unread;

export const describeAction = (id: ActionId, c: ConversationSummary): RowAction => {
  const name = conversationTitle(c);
  switch (id) {
    case 'read':
      return isUnread(c)
        ? { id, label: 'Read', ariaLabel: `Mark chat with ${name} as read` }
        : { id, label: 'Unread', ariaLabel: `Mark chat with ${name} as unread` };
    case 'pin':
      return c.prefs.pinned
        ? { id, label: 'Unpin', ariaLabel: `Unpin chat with ${name}` }
        : { id, label: 'Pin', ariaLabel: `Pin chat with ${name}` };
    case 'mute':
      return isMuted(c.prefs)
        ? { id, label: 'Unmute', ariaLabel: `Unmute chat with ${name}` }
        : { id, label: 'Mute', ariaLabel: `Mute chat with ${name}` };
    case 'archive':
      return c.prefs.archived
        ? { id, label: 'Unarchive', ariaLabel: `Unarchive chat with ${name}` }
        : { id, label: 'Archive', ariaLabel: `Archive chat with ${name}` };
    case 'delete':
      return isClearOnly(c)
        ? { id, label: 'Clear', ariaLabel: `Clear chat with ${name}`, destructive: true }
        : { id, label: 'Delete', ariaLabel: `Delete chat with ${name}`, destructive: true };
  }
};

/** The wording in the "⋮" menu, which has room for full phrases. */
export const menuLabel = (id: ActionId, c: ConversationSummary): string => {
  switch (id) {
    case 'read':
      return isUnread(c) ? 'Mark as read' : 'Mark as unread';
    case 'pin':
      return c.prefs.pinned ? 'Unpin chat' : 'Pin chat';
    case 'mute':
      return isMuted(c.prefs) ? 'Unmute' : 'Mute…';
    case 'archive':
      return c.prefs.archived ? 'Unarchive chat' : 'Archive chat';
    case 'delete':
      return isClearOnly(c) ? 'Clear chat' : 'Delete chat';
  }
};

/** The buttons behind a row: swiping right shows `start`, swiping left shows `end`. */
export const actionIdsFor = (c: ConversationSummary, side: Side): ActionId[] => {
  const fixed = isFlickChat(c); // the assistant chat cannot be pinned or archived
  if (side === 'start') return fixed ? ['read'] : ['read', 'pin'];
  return fixed ? ['mute', 'delete'] : ['mute', 'archive', 'delete'];
};

/** What a long swipe does: pin on the right, archive on the left (the first useful action). */
export const longSwipeAction = (c: ConversationSummary, side: Side): ActionId => {
  const fixed = isFlickChat(c);
  if (side === 'start') return fixed ? 'read' : 'pin';
  return fixed ? 'mute' : 'archive';
};

/** Every action a chat has in its "⋮" menu, in order. */
export const menuActionIds = (c: ConversationSummary): ActionId[] => {
  if (c.is_saved) return ['delete']; // Saved messages: only "Clear chat"
  return isFlickChat(c) ? ['read', 'mute', 'delete'] : ['read', 'pin', 'mute', 'archive', 'delete'];
};

// ---------------------------------------------------------------- the actions themselves

export const archiveChats = async (chats: ConversationSummary[]): Promise<void> => {
  const results = await Promise.all(chats.map((c) => updatePrefs(c.id, { archived: true })));
  const done = chats.filter((_, i) => results[i]);
  if (done.length === 0) return;
  const { selectedId, select } = useChatStore.getState();
  if (selectedId && done.some((c) => c.id === selectedId)) select(null);
  notify.withAction(
    done.length === 1 ? 'Chat archived' : `${done.length} chats archived`,
    'Undo',
    () => {
      void Promise.all(done.map((c) => updatePrefs(c.id, { archived: false })));
    },
  );
};

export const unarchiveChats = async (chats: ConversationSummary[]): Promise<void> => {
  await Promise.all(chats.map((c) => updatePrefs(c.id, { archived: false })));
};

export const pinChats = async (chats: ConversationSummary[], pinned: boolean): Promise<void> => {
  // One after another: the server limits pins and its answer tells the person why.
  for (const c of chats) if (c.prefs.pinned !== pinned) await updatePrefs(c.id, { pinned });
};

export const muteChats = async (
  chats: ConversationSummary[],
  mutedUntil: string | null,
): Promise<void> => {
  await Promise.all(chats.map((c) => updatePrefs(c.id, { muted_until: mutedUntil })));
};

/** Acknowledge everything in these chats (like opening them) and drop the manual "unread" dot. */
export const markChatsRead = async (chats: ConversationSummary[]): Promise<void> => {
  const transport = getTransport();
  const unread = chats.filter((c) => c.unread_count > 0);
  if (unread.length > 0 && transport.state === 'connected') {
    for (const c of unread) {
      void transport.request('read_ack', { conversation_id: c.id, seq: c.last_seq });
      useMentions.getState().clear(c.id);
    }
    useChatStore.setState((s) => {
      const conversations = { ...s.conversations };
      for (const c of unread) {
        const now = conversations[c.id];
        if (now) {
          conversations[c.id] = {
            ...now,
            read_seq: Math.max(now.read_seq, now.last_seq),
            unread_count: 0,
          };
        }
      }
      return { conversations };
    });
  }
  await Promise.all(
    chats
      .filter((c) => c.prefs.marked_unread)
      .map((c) => updatePrefs(c.id, { marked_unread: false })),
  );
};

/** "Mark as unread" shows a dot until the chat is opened. An open chat is closed first. */
export const markChatsUnread = async (chats: ConversationSummary[]): Promise<void> => {
  const { selectedId, select } = useChatStore.getState();
  if (selectedId && chats.some((c) => c.id === selectedId)) select(null);
  await Promise.all(chats.map((c) => updatePrefs(c.id, { marked_unread: true })));
};

/** The read/unread button: marks everything read if any chat is unread, otherwise unread. */
export const toggleRead = async (chats: ConversationSummary[]): Promise<void> => {
  if (chats.some(isUnread)) await markChatsRead(chats);
  else await markChatsUnread(chats);
};

/** A chat that was opened is no longer "marked as unread". */
export const clearMarkedUnreadOnOpen = (conversationId: string): void => {
  const c = useChatStore.getState().conversations[conversationId];
  if (c?.prefs.marked_unread) void updatePrefs(conversationId, { marked_unread: false });
};

/** After a clear, the open copy of the chat is emptied without a reload. */
const emptyHere = (id: string): void => {
  useChatStore.setState((s) => {
    const c = s.conversations[id];
    const t = s.threads[id];
    return {
      conversations: c
        ? {
            ...s.conversations,
            [id]: { ...c, last_message: null, unread_count: 0, read_seq: c.last_seq },
          }
        : s.conversations,
      threads: t ? { ...s.threads, [id]: { ...t, messages: [] } } : s.threads,
    };
  });
};

/**
 * "Delete chat" for me. Direct chats: the server removes my copy and the chat leaves my list
 * (it comes back with only newer messages if someone writes again). Groups: leave, then the
 * chat is gone. The assistant chat and Saved messages: only the history is cleared.
 * Returns how many chats were handled.
 */
export const deleteChats = async (chats: ConversationSummary[]): Promise<number> => {
  let done = 0;
  for (const c of chats) {
    try {
      if (c.type === 'group') {
        await getApi().call(ENDPOINTS.conversations.leave, {
          params: { conversation_id: c.id },
        });
        useChatStore.getState().removeConversations([c.id]);
      } else {
        await getApi().call(ENDPOINTS.conversations.deleteForMe, {
          params: { conversation_id: c.id },
        });
        if (isClearOnly(c)) emptyHere(c.id);
        else useChatStore.getState().removeConversations([c.id]);
      }
      useDraftStore.getState().setDraft(c.id, '');
      done += 1;
    } catch (error) {
      notify.error(
        getErrorMessage(error, `Couldn't delete the chat with ${conversationTitle(c)}.`),
      );
    }
  }
  return done;
};
