// Which chats have an unread message that mentions me, for the "@" mark in the chat list.
// Kept in memory only: it is a hint for this session, cleared as soon as the chat is read.
import { create } from 'zustand';

interface MentionState {
  chats: Record<string, true>;
  mark: (conversationId: string) => void;
  clear: (conversationId: string) => void;
  clearAll: () => void;
}

export const useMentions = create<MentionState>()((set) => ({
  chats: {},
  mark: (id) => {
    set((s) => ({ chats: { ...s.chats, [id]: true } }));
  },
  clear: (id) => {
    set((s) => {
      if (!(id in s.chats)) return s;
      return { chats: Object.fromEntries(Object.entries(s.chats).filter(([k]) => k !== id)) };
    });
  },
  clearAll: () => {
    set({ chats: {} });
  },
}));
