import { create } from 'zustand';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

// My private notes on messages, loaded once per chat and kept here so a bubble never asks
// the server by itself.
interface NoteState {
  /** message_id -> note text */
  notes: Record<string, string>;
  loaded: Record<string, true>;
  ensureLoaded: (conversationId: string) => Promise<void>;
  save: (conversationId: string, messageId: string, body: string) => Promise<void>;
  remove: (conversationId: string, messageId: string) => Promise<void>;
}

export const useNoteStore = create<NoteState>()((set, get) => ({
  notes: {},
  loaded: {},

  ensureLoaded: async (conversationId) => {
    if (get().loaded[conversationId]) return;
    // Marked first so a chat full of bubbles asks only once.
    set((s) => ({ loaded: { ...s.loaded, [conversationId]: true } }));
    try {
      const res = await getApi().call(ENDPOINTS.notes.list, {
        params: { conversation_id: conversationId },
      });
      set((s) => ({
        notes: { ...s.notes, ...Object.fromEntries(res.notes.map((n) => [n.message_id, n.body])) },
      }));
    } catch {
      set((s) => {
        const { [conversationId]: _drop, ...rest } = s.loaded;
        return { loaded: rest };
      });
    }
  },

  save: async (conversationId, messageId, body) => {
    const res = await getApi().call(ENDPOINTS.notes.put, {
      params: { conversation_id: conversationId, message_id: messageId },
      body: { body },
    });
    set((s) => ({ notes: { ...s.notes, [messageId]: res.body } }));
  },

  remove: async (conversationId, messageId) => {
    await getApi().call(ENDPOINTS.notes.delete, {
      params: { conversation_id: conversationId, message_id: messageId },
    });
    set((s) => {
      const { [messageId]: _drop, ...rest } = s.notes;
      return { notes: rest };
    });
  },
}));
