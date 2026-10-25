import { create } from 'zustand';
import { ENDPOINTS, type Reminder } from '@chat/contracts';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

// All of the person's reminders (waiting ones and recently sent ones), loaded once and kept here.
// The reminders list reads it, and so does the small alarm mark on a message, so a chat with many
// messages never asks the server per message.

interface ReminderState {
  items: Reminder[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Loads the first time only. */
  ensureLoaded: () => Promise<void>;
  /** Always asks the server (the list dialog does this when it opens). */
  load: () => Promise<void>;
  add: (reminder: Reminder) => void;
  remove: (id: string) => void;
  reset: () => void;
}

// 50 waiting reminders at most plus a few days of sent ones: a few pages at the very most.
const PAGE = 100;
const MAX_PAGES = 5;

const initial = { items: [] as Reminder[], status: 'idle' as const, error: null };

const byTime = (a: Reminder, b: Reminder): number => a.remind_at.localeCompare(b.remind_at);

export const useReminderStore = create<ReminderState>()((set, get) => ({
  ...initial,

  ensureLoaded: async () => {
    if (get().status === 'idle') await get().load();
  },

  load: async () => {
    // Keep showing what we have while it refreshes.
    set((s) => ({ status: s.items.length ? s.status : 'loading', error: null }));
    try {
      const items: Reminder[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await getApi().call(ENDPOINTS.reminders.list, {
          query: { limit: PAGE, ...(cursor ? { cursor } : {}) },
        });
        items.push(...res.items);
        if (!res.next_cursor) break;
        cursor = res.next_cursor;
      }
      set({ items, status: 'ready', error: null });
    } catch (e) {
      set({ status: 'error', error: getErrorMessage(e, "Couldn't load your reminders.") });
    }
  },

  add: (reminder) => {
    set((s) => ({
      items: [...s.items.filter((r) => r.id !== reminder.id), reminder].sort(byTime),
    }));
  },

  remove: (id) => {
    set((s) => ({ items: s.items.filter((r) => r.id !== id) }));
  },

  reset: () => {
    set(initial);
  },
}));

/** True when a message has a reminder that has not gone off yet (a cheap selector for the mark). */
export const hasPendingReminder =
  (messageId: string) =>
  (s: ReminderState): boolean =>
    s.items.some((r) => r.status === 'pending' && r.message_id === messageId);
