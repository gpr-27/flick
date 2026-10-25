// Select mode of the chat list: which chats are ticked for a bulk action.
import { create } from 'zustand';

interface SelectionState {
  /** True from the moment select mode starts, even while nothing is ticked. */
  active: boolean;
  ids: string[];
  /** Start select mode, optionally with one chat already ticked. */
  begin: (id?: string) => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  end: () => void;
}

export const useSelection = create<SelectionState>()((set) => ({
  active: false,
  ids: [],
  begin: (id) => {
    set({ active: true, ids: id ? [id] : [] });
  },
  toggle: (id) => {
    set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] }));
  },
  selectAll: (ids) => {
    set({ ids });
  },
  end: () => {
    set({ active: false, ids: [] });
  },
}));
