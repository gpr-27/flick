// Whether a new app version is waiting. Filled by register.ts, read by UpdateBanner.
import { create } from 'zustand';

interface UpdateState {
  updateReady: boolean;
  /** Activates the waiting worker and reloads the page. */
  applyUpdate: () => void;
}

export const useUpdateStore = create<UpdateState>()(() => ({
  updateReady: false,
  applyUpdate: () => undefined,
}));
