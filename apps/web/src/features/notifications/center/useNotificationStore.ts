// The notification centre's state: the alerts the person got, newest first, and the unread count
// behind the bell. The server holds the truth; this store is a cache of the first pages.
import { create } from 'zustand';
import { ENDPOINTS, type NotificationItem } from '@chat/contracts';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

const PAGE = 30;

interface NotificationState {
  items: NotificationItem[];
  next: string | null;
  unread: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error: string;
  load: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Just the number for the bell (cheap; used at start, on focus and when an alert arrives). */
  refreshUnread: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clear: () => Promise<void>;
  reset: () => void;
}

const initial = {
  items: [] as NotificationItem[],
  next: null as string | null,
  unread: 0,
  status: 'idle' as const,
  loadingMore: false,
  error: '',
};

export const useNotificationStore = create<NotificationState>()((set, get) => ({
  ...initial,

  load: async () => {
    if (get().status !== 'ready') set({ status: 'loading' });
    try {
      const page = await getApi().call(ENDPOINTS.notifications.list, { query: { limit: PAGE } });
      set({
        items: page.items,
        next: page.next_cursor,
        unread: page.unread_count,
        status: 'ready',
      });
    } catch (e) {
      set({ status: 'error', error: getErrorMessage(e, "Couldn't load your notifications.") });
    }
  },

  loadMore: async () => {
    const { next, loadingMore } = get();
    if (!next || loadingMore) return;
    set({ loadingMore: true });
    try {
      const page = await getApi().call(ENDPOINTS.notifications.list, {
        query: { cursor: next, limit: PAGE },
      });
      set((s) => ({
        items: [...s.items, ...page.items],
        next: page.next_cursor,
        unread: page.unread_count,
      }));
    } catch (e) {
      set({ error: getErrorMessage(e, "Couldn't load more.") });
    } finally {
      set({ loadingMore: false });
    }
  },

  refreshUnread: async () => {
    try {
      const { unread_count } = await getApi().call(ENDPOINTS.notifications.unread);
      set({ unread: unread_count });
    } catch {
      // the bell keeps its last number
    }
  },

  markRead: async (id) => {
    const target = get().items.find((i) => i.id === id);
    if (!target || target.read) return;
    set((s) => ({
      items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)),
      unread: Math.max(0, s.unread - 1),
    }));
    try {
      const { unread_count } = await getApi().call(ENDPOINTS.notifications.markRead, {
        body: { ids: [id] },
      });
      set({ unread: unread_count });
    } catch {
      // the server will say the right number the next time the list loads
    }
  },

  markAllRead: async () => {
    set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })), unread: 0 }));
    try {
      await getApi().call(ENDPOINTS.notifications.markRead, { body: { all: true } });
    } catch {
      void get().load();
    }
  },

  clear: async () => {
    set({ items: [], next: null, unread: 0 });
    try {
      await getApi().call(ENDPOINTS.notifications.clear);
    } catch {
      void get().load();
    }
  },

  reset: () => {
    set({ ...initial });
  },
}));
