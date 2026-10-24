// Chat lock. This is a convenience lock, NOT security: the server stores the hash we send and
// never checks it, and the messages stay readable through the API. It only hides a chat on
// screen until the passcode is typed in this browser tab.
//
// The hash is PBKDF2-SHA-256 with the conversation id as the salt. The salt must be derivable
// (not random) so the owner's other devices can check the same passcode against `lock_hash`.
import { create } from 'zustand';

const ITERATIONS = 100_000;
const PREFIX = 'flick-chat-lock:';
const KEY = 'flick:unlocked-chats';

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const hashPasscode = async (conversationId: string, passcode: string): Promise<string> => {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: enc.encode(PREFIX + conversationId),
      iterations: ITERATIONS,
    },
    key,
    256,
  );
  return toHex(bits);
};

export const passcodeMatches = async (
  conversationId: string,
  passcode: string,
  lockHash: string | null,
): Promise<boolean> =>
  lockHash !== null && (await hashPasscode(conversationId, passcode)) === lockHash;

// Chats unlocked in this tab. sessionStorage dies with the tab, which is the lifetime we want.
const readUnlocked = (): Record<string, true> => {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, true>) : {};
  } catch {
    return {};
  }
};

interface LockState {
  unlocked: Record<string, true>;
  unlock: (conversationId: string) => void;
  relock: (conversationId: string) => void;
}

const save = (unlocked: Record<string, true>): void => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(unlocked));
  } catch {
    // Without storage the chat simply locks again on reload.
  }
};

export const useLockStore = create<LockState>()((set, get) => ({
  unlocked: readUnlocked(),
  unlock: (id) => {
    const unlocked = { ...get().unlocked, [id]: true as const };
    save(unlocked);
    set({ unlocked });
  },
  relock: (id) => {
    const { [id]: _removed, ...unlocked } = get().unlocked;
    save(unlocked);
    set({ unlocked });
  },
}));

/** True when the chat is locked and the passcode has not been entered in this tab. */
export const useIsHidden = (conversationId: string, locked: boolean): boolean =>
  useLockStore((s) => locked && !s.unlocked[conversationId]);
