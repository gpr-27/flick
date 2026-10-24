// The signed-in user's profile (from /users/me). Who is signed in is Clerk's job; this store only
// holds the local user record the chat code needs, and is loaded after Clerk says "signed in".
import { create } from 'zustand';
import { ENDPOINTS, type Me as MeSchema } from '@chat/contracts';
import type { z } from 'zod';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

export type Me = z.infer<typeof MeSchema>;

interface SessionState {
  /** booting = the profile is loading; authenticated = loaded; anonymous = signed out. */
  status: 'booting' | 'anonymous' | 'authenticated';
  user: Me | null;
  error: string | null;

  load: () => Promise<void>;
  reset: () => void;
  setUser: (user: Me) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  status: 'booting',
  user: null,
  error: null,

  load: async () => {
    set({ status: 'booting', error: null });
    try {
      const user = await getApi().call(ENDPOINTS.users.me);
      set({ status: 'authenticated', user });
    } catch (error) {
      set({ status: 'booting', error: getErrorMessage(error, "Can't reach the server.") });
    }
  },

  reset: () => {
    set({ status: 'anonymous', user: null, error: null });
  },

  setUser: (user) => {
    set({ user });
  },
}));
