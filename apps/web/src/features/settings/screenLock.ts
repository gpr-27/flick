// The app lock: a PIN asked for when Flick is opened in a new tab. Like the chat lock it is a
// convenience, NOT security: it keeps someone who picks up your unlocked device from reading
// Flick at a glance, but the hash is in localStorage and the messages are reachable by the API.
// It reuses the chat lock's PBKDF2 hashing with a fixed salt name instead of a conversation id.
import { create } from 'zustand';
import { hashPasscode } from '@/features/organise/lock';
import { useSettingsStore } from './useSettingsStore';

const SALT_NAME = 'flick-app-lock';
const UNLOCKED_KEY = 'flick:app-unlocked';

export const PIN_PATTERN = /^\d{4,8}$/;

export const hashPin = (pin: string): Promise<string> => hashPasscode(SALT_NAME, pin);

/** True when `pin` is the PIN the lock was set with. */
export const pinMatches = async (pin: string, hash: string | null): Promise<boolean> =>
  hash !== null && PIN_PATTERN.test(pin) && (await hashPin(pin)) === hash;

const readUnlocked = (): boolean => {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
};

interface LockState {
  /** The PIN was entered in this tab (sessionStorage dies with the tab). */
  unlocked: boolean;
  unlock: () => void;
  lockNow: () => void;
}

export const useAppLock = create<LockState>()((set) => ({
  unlocked: readUnlocked(),
  unlock: () => {
    try {
      sessionStorage.setItem(UNLOCKED_KEY, '1');
    } catch {
      // without storage the lock simply asks again on reload
    }
    set({ unlocked: true });
  },
  lockNow: () => {
    try {
      sessionStorage.removeItem(UNLOCKED_KEY);
    } catch {
      // nothing to forget
    }
    set({ unlocked: false });
  },
}));

/** True when a PIN is set and has not been entered in this tab yet. */
export const useIsAppLocked = (): boolean => {
  const hash = useSettingsStore((s) => s.screenLockHash);
  const unlocked = useAppLock((s) => s.unlocked);
  return hash !== null && !unlocked;
};
