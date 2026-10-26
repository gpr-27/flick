// The caller's chat folders and coloured tags. Loaded once; each change updates the store from
// the server's answer.
import { create } from 'zustand';
import { ENDPOINTS, type ChatListItem } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

export const TAG_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

interface ListsState {
  lists: ChatListItem[];
  loaded: boolean;
  load: () => Promise<void>;
  create: (kind: ChatListItem['kind'], name: string, color?: string) => Promise<void>;
  toggle: (list: ChatListItem, conversationId: string) => Promise<void>;
  remove: (listId: string) => Promise<void>;
}

const fail = (e: unknown): void => {
  notify.error(getErrorMessage(e, "Couldn't update your lists."));
};

export const useChatLists = create<ListsState>((set, get) => ({
  lists: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    try {
      const res = await getApi().call(ENDPOINTS.chatLists.list, {});
      set({ lists: res.items });
    } catch {
      set({ loaded: false });
    }
  },
  create: async (kind, name, color) => {
    try {
      const made = await getApi().call(ENDPOINTS.chatLists.create, {
        body: { kind, name, ...(color ? { color } : {}) },
      });
      set((s) => ({ lists: [...s.lists, made] }));
    } catch (e) {
      fail(e);
    }
  },
  toggle: async (list, conversationId) => {
    const ids = toggleId(list.conversation_ids, conversationId);
    try {
      const saved = await getApi().call(ENDPOINTS.chatLists.update, {
        params: { list_id: list.id },
        body: { conversation_ids: ids },
      });
      set((s) => ({ lists: s.lists.map((l) => (l.id === saved.id ? saved : l)) }));
    } catch (e) {
      fail(e);
    }
  },
  remove: async (listId) => {
    try {
      await getApi().call(ENDPOINTS.chatLists.remove, { params: { list_id: listId } });
      set((s) => ({ lists: s.lists.filter((l) => l.id !== listId) }));
    } catch (e) {
      fail(e);
    }
  },
}));

export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/** The tags a chat has, for the dots on its row. */
export const tagsOf = (lists: readonly ChatListItem[], conversationId: string): ChatListItem[] =>
  lists.filter((l) => l.kind === 'tag' && l.conversation_ids.includes(conversationId));
