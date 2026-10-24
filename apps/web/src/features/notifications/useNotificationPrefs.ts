// This device's notification choices. Kept in localStorage: they are per browser, not per account.
// Whether push is on is not stored here; the browser's push subscription is the source of truth.
import { create } from 'zustand';

const KEY = 'flick-notification-prefs';

interface Prefs {
  /** Play a short sound for a message that arrives while the tab is hidden. */
  sound: boolean;
}

interface PrefsState extends Prefs {
  setSound: (sound: boolean) => void;
}

const load = (): Prefs => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      if (typeof parsed.sound === 'boolean') return { sound: parsed.sound };
    }
  } catch {
    // storage blocked or corrupt: use defaults
  }
  return { sound: true };
};

export const useNotificationPrefs = create<PrefsState>()((set) => ({
  ...load(),
  setSound: (sound) => {
    set({ sound });
    try {
      localStorage.setItem(KEY, JSON.stringify({ sound }));
    } catch {
      // not persisted; still applies for this session
    }
  },
}));
