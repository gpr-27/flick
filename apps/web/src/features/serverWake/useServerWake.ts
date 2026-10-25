import { create } from 'zustand';
import { config } from '@/config/env';
import { waitForServer } from './serverWake';

interface ServerWakeState {
  /** True while the server has not answered in time. */
  waking: boolean;
  /** When the waiting started (ms since the epoch), for the "waiting 23 s" counter. */
  since: number | null;
  /** Ask the server if it is awake (does nothing if a check is already running). */
  check: () => void;
  /** Stop checking (the notice left the page) and hide the message. */
  stop: () => void;
}

// The check that is running now, if any. Held outside the store: it is not something to render.
let current: AbortController | null = null;

export const useServerWake = create<ServerWakeState>()((set) => ({
  waking: false,
  since: null,
  check: () => {
    // Tests have no real server, and an offline device is already told so by its own notice.
    if (current || config.env === 'test' || !navigator.onLine) return;
    const mine = new AbortController();
    current = mine;
    const url = new URL('/health/live', config.socketUrl).toString();
    void waitForServer(url, {
      signal: mine.signal,
      onWaking: () => {
        set((s) => (s.waking ? s : { waking: true, since: Date.now() }));
      },
    }).finally(() => {
      // A newer check may have started after this one was stopped: only clean up our own.
      if (current === mine) {
        current = null;
        set({ waking: false, since: null });
      }
    });
  },
  stop: () => {
    current?.abort();
    current = null;
    set({ waking: false, since: null });
  },
}));
