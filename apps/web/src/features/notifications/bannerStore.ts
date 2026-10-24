// The "new message in another chat" banner that shows while the app is open and visible.
import { create } from 'zustand';

export interface Incoming {
  conversationId: string;
  title: string;
  text: string;
}

interface BannerState {
  current: Incoming | null;
  show: (incoming: Incoming) => void;
  dismiss: () => void;
}

export const useIncomingBanner = create<BannerState>()((set) => ({
  current: null,
  show: (current) => {
    set({ current });
  },
  dismiss: () => {
    set({ current: null });
  },
}));
