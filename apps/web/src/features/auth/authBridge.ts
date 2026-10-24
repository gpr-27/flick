// Bridge between Clerk (React hooks) and plain modules such as the API client and the socket.
// `useClerkBridge` (App.tsx) registers Clerk's getToken / signOut here; everything else calls
// these functions. Clerk renews its session tokens itself, so there is no refresh logic.
const DEVICE_KEY = 'flick.device_id';

let memoryDeviceId: string | null = null;

/** A UUID generated once per browser and kept in localStorage. */
export const getDeviceId = (): string => {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    // Storage blocked: stable for this page load at least.
    memoryDeviceId ??= crypto.randomUUID();
    return memoryDeviceId;
  }
};

export interface ClerkBridge {
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

let bridge: ClerkBridge | null = null;

export const setClerkBridge = (next: ClerkBridge | null): void => {
  bridge = next;
};

/** The current Clerk session token (null when signed out). */
export const getSessionToken = async (): Promise<string | null> =>
  (await bridge?.getToken()) ?? null;

/** Sign out through Clerk. */
export const signOutOfClerk = async (): Promise<void> => {
  await bridge?.signOut();
};
