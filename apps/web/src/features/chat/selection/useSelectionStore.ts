// Which messages are ticked while choosing several. Only one chat can have a selection at a time;
// leaving the chat clears it. Ids only: the messages themselves come from the open thread.
import { create } from 'zustand';

interface SelectionState {
  conversationId: string | null;
  ids: readonly string[];
  /** Tick a message, or untick it. Unticking the last one ends the selection. */
  toggle: (conversationId: string, messageId: string) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  conversationId: null,
  ids: [],
  toggle: (conversationId, messageId) => {
    set((s) => {
      // Another chat's leftovers never mix with this one.
      const current = s.conversationId === conversationId ? s.ids : [];
      const ids = current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId];
      return { conversationId: ids.length > 0 ? conversationId : null, ids };
    });
  },
  clear: () => {
    set({ conversationId: null, ids: [] });
  },
}));

const NONE: readonly string[] = [];

/** The ticked message ids of this chat (empty when nothing is selected here). */
export const useSelectedIds = (conversationId: string): readonly string[] =>
  useSelectionStore((s) => (s.conversationId === conversationId ? s.ids : NONE));
