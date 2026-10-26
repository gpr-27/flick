// The red number on the Calls link: missed incoming calls since the Calls tab was last opened.
import { useEffect } from 'react';
import { create } from 'zustand';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import type { CallLogEntry } from '../groupcall/types';

const SEEN_KEY = 'flick:calls-seen-at';

const readSeen = (): number => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

/** Missed incoming calls that started after `seenAt` (ms). */
export const countMissed = (entries: CallLogEntry[], seenAt: number): number =>
  entries.filter(
    (e) =>
      e.outcome === 'missed' && e.direction === 'incoming' && Date.parse(e.started_at) > seenAt,
  ).length;

interface MissedState {
  count: number;
  refresh: () => Promise<void>;
  markSeen: () => void;
}

export const useMissedCalls = create<MissedState>()((set) => ({
  count: 0,
  refresh: async () => {
    try {
      const page = await getApi().call(ENDPOINTS.calls.log, { query: { limit: 30 } });
      set({ count: countMissed(page.items, readSeen()) });
    } catch {
      // the badge is a nicety; no number is fine
    }
  },
  markSeen: () => {
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()));
    } catch {
      // without storage the badge simply comes back next time
    }
    set({ count: 0 });
  },
}));

/** Load the count once when the nav mounts. */
export const useLoadMissedCalls = (enabled: boolean): number => {
  const count = useMissedCalls((s) => s.count);
  useEffect(() => {
    if (enabled) void useMissedCalls.getState().refresh();
  }, [enabled]);
  return count;
};
