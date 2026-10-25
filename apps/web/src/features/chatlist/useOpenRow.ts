// Which chat row is swiped open. Only one at a time: opening a row closes the one that was open.
import { create } from 'zustand';
import type { Side } from './swipeGesture';

interface OpenRowState {
  openId: string | null;
  side: Side | null;
  open: (id: string, side: Side) => void;
  close: () => void;
}

export const useOpenRow = create<OpenRowState>()((set, get) => ({
  openId: null,
  side: null,
  open: (id, side) => {
    set({ openId: id, side });
  },
  close: () => {
    if (get().openId !== null) set({ openId: null, side: null });
  },
}));
