// "Mark all as read" for the chat list: acknowledge every chat that has unread messages.
import { getTransport } from '@/lib/services';
import { useChatStore } from '../chat/useChatStore';
import { useMentions } from './mentions';

/** Returns how many chats were marked. Does nothing while offline (the acks could not be sent). */
export const markAllRead = (): number => {
  const transport = getTransport();
  if (transport.state !== 'connected') return 0;
  const unread = Object.values(useChatStore.getState().conversations).filter(
    (c) => c.unread_count > 0,
  );
  for (const c of unread) {
    void transport.request('read_ack', { conversation_id: c.id, seq: c.last_seq });
  }
  useChatStore.setState((s) => {
    const conversations = { ...s.conversations };
    for (const c of unread) {
      conversations[c.id] = { ...c, read_seq: Math.max(c.read_seq, c.last_seq), unread_count: 0 };
    }
    return { conversations };
  });
  useMentions.getState().clearAll();
  return unread.length;
};
