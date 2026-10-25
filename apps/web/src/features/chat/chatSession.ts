// Connects the realtime transport to the chat stores for as long as a user is signed in.
// This is the one place that knows the whole order of events after a (re)connect:
//
//   socket connected -> sync every conversation -> outbox resends -> chat is live
import { useSessionStore } from '@/features/auth/useSessionStore';
import type { Unsubscribe } from '@/lib/realtime';
import { getTransport } from '@/lib/services';
import { useReminderStore } from '@/features/reminders/reminderStore';
import { usePinsStore } from '../organise/messageActions';
import { useOutboxStore } from './outbox/useOutboxStore';
import { onSynced, syncEngine, useChatStore } from './useChatStore';

/** The users whose online status the screen shows: direct-chat peers plus the open group's members. */
const watchedUserIds = (): string[] => {
  const { conversations, members, selectedId } = useChatStore.getState();
  const ids = new Set<string>();
  for (const c of Object.values(conversations)) if (c.peer) ids.add(c.peer.id);
  const open = selectedId ? conversations[selectedId] : undefined;
  if (open?.type === 'group') for (const m of members[open.id] ?? []) ids.add(m.user.id);
  ids.delete(useSessionStore.getState().user?.id ?? '');
  return [...ids].sort().slice(0, 256);
};

export function startChatSession(userId: string): Unsubscribe {
  const transport = getTransport();
  const chat = useChatStore.getState;
  const outbox = useOutboxStore.getState;
  let watchedKey: string | null = null;

  /** Sync once the chat list is loaded AND the socket is authenticated, whichever comes last. */
  const syncIfReady = (): void => {
    if (transport.state === 'connected' && chat().listStatus === 'ready') syncEngine.start();
  };

  const subscribePresence = (): void => {
    if (transport.state !== 'connected') return;
    const ids = watchedUserIds();
    const key = ids.join(',');
    if (key === watchedKey) return;
    watchedKey = key;
    void transport.request('presence_subscribe', { user_ids: ids }).then((ack) => {
      if (!ack.ok)
        watchedKey = null; // try again on the next change or reconnect
      else for (const p of ack.data) chat().presenceUpdate(p.user_id, p.online, p.last_seen_at);
    });
  };

  void outbox().hydrate(userId);
  void chat().loadConversations().then(syncIfReady);

  let syncedOnce = false;
  const offs: Unsubscribe[] = [
    // Live changes go through the sync engine, which orders them and spots gaps.
    transport.on('new_message', (payload) => {
      syncEngine.onLive({ type: 'new_message', payload });
    }),
    transport.on('message_edited', (payload) => {
      syncEngine.onLive({ type: 'message_edited', payload });
    }),
    transport.on('message_deleted', (payload) => {
      syncEngine.onLive({ type: 'message_deleted', payload });
    }),
    transport.on('reaction_added', (payload) => {
      syncEngine.onLive({ type: 'reaction_added', payload });
    }),
    transport.on('reaction_removed', (payload) => {
      syncEngine.onLive({ type: 'reaction_removed', payload });
    }),

    transport.on('receipt_update', (update) => {
      chat().receiptUpdate(update);
    }),
    transport.on('typing_start', ({ conversation_id, user_id }) => {
      chat().setActivity(conversation_id, user_id, 'typing');
    }),
    transport.on('typing_stop', ({ conversation_id, user_id }) => {
      chat().setActivity(conversation_id, user_id, null);
    }),
    transport.on('activity', ({ conversation_id, user_id, activity, state }) => {
      chat().setActivity(conversation_id, user_id, state === 'start' ? activity : null);
    }),
    transport.on('presence_update', ({ user_id, online, last_seen_at }) => {
      chat().presenceUpdate(user_id, online, last_seen_at);
    }),
    transport.on('pins_changed', (change) => {
      usePinsStore.getState().applyChange(change);
    }),
    transport.on('user_updated', (profile) => {
      chat().userUpdated(profile);
      // Another device of mine renamed me: keep my own record in step.
      const session = useSessionStore.getState();
      if (session.user?.id === profile.user_id) {
        session.setUser({
          ...session.user,
          display_name: profile.display_name,
          username: profile.username,
          avatar_url: profile.avatar_url,
        });
      }
    }),
    transport.on('conversation_updated', ({ conversation_id, conversation }) => {
      chat().conversationUpdated(conversation_id, conversation);
    }),

    transport.onStateChange((state) => {
      if (state === 'connected') {
        watchedKey = null; // subscriptions belong to a connection
        syncIfReady();
      } else {
        syncEngine.stop();
        outbox().setReady(false);
        chat().clearTyping();
      }
    }),

    onSynced(() => {
      subscribePresence();
      if (syncedOnce) void chat().refreshConversations();
      syncedOnce = true;
      // Only now: the catch-up is done, so our unsent messages cannot overtake what we missed.
      outbox().setReady(true);
    }),

    // Re-watch when the chat list or the open group changes.
    useChatStore.subscribe((state, previous) => {
      if (
        state.conversations !== previous.conversations ||
        state.selectedId !== previous.selectedId ||
        state.members !== previous.members
      ) {
        subscribePresence();
      }
    }),
  ];

  // The transport may already be connected by the time we start listening.
  syncIfReady();

  return () => {
    for (const off of offs) off();
    syncEngine.stop();
    outbox().setReady(false);
  };
}

/** Sign-out: forget the previous user's chats and unsent messages. */
export function resetChatSession(): void {
  useChatStore.getState().reset();
  useReminderStore.getState().reset();
  void useOutboxStore.getState().clear();
}

/** Once, at startup: whenever the user signs out (or is signed out), clear the chat state. */
export function bindSignOutReset(): void {
  useSessionStore.subscribe((state, previous) => {
    if (previous.user && !state.user) resetChatSession();
  });
}
