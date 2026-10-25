// TEST ONLY. Stands in for `@clerk/clerk-react` in the browser (Playwright) tests, where the real
// login needs a person. vite.config.ts aliases the Clerk package to this file only when the build
// is made with VITE_E2E_FAKE_AUTH=true, so a normal build never contains it. It exports just the
// pieces the app uses. The user is named in the URL (`?as=alice`) and remembered in sessionStorage;
// the token is `fake:<name>`, which the API accepts only when it runs with E2E_FAKE_AUTH=true.
/* eslint-disable react-refresh/only-export-components -- mirrors the Clerk package, which mixes hooks and components */
import { createContext, useContext, type ReactNode } from 'react';

const STORAGE_KEY = 'flick.e2e_user';
const NAME_PATTERN = /^[A-Za-z0-9_.]{3,24}$/;

/** The fake user: `?as=` in the URL wins (and is remembered), else the remembered one, else none. */
export const resolveFakeUser = (
  search: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): string | null => {
  const fromUrl = new URLSearchParams(search).get('as');
  if (fromUrl && NAME_PATTERN.test(fromUrl)) {
    storage.setItem(STORAGE_KEY, fromUrl);
    return fromUrl;
  }
  const saved = storage.getItem(STORAGE_KEY);
  return saved && NAME_PATTERN.test(saved) ? saved : null;
};

export const fakeToken = (name: string): string => `fake:${name}`;

const UserContext = createContext<string | null>(null);

export const ClerkProvider = ({ children }: { children: ReactNode; publishableKey?: string }) => (
  <UserContext.Provider value={resolveFakeUser(window.location.search, sessionStorage)}>
    {children}
  </UserContext.Provider>
);

export const useAuth = () => {
  const name = useContext(UserContext);
  return {
    getToken: () => Promise.resolve(name ? fakeToken(name) : null),
    signOut: () => {
      sessionStorage.removeItem(STORAGE_KEY);
      window.location.assign('/');
      return Promise.resolve();
    },
  };
};

/** The fake login has no Clerk account behind it, so there is no user object to update. */
export const useUser = () => ({ isLoaded: true, user: null });

export const ClerkLoading = () => null;
export const SignedIn = ({ children }: { children: ReactNode }) =>
  useContext(UserContext) ? <>{children}</> : null;
export const SignedOut = ({ children }: { children: ReactNode }) =>
  useContext(UserContext) ? null : <>{children}</>;

export const UserButton = () => {
  const { signOut } = useAuth();
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
      Sign out
    </button>
  );
};

const NeedsName = () => (
  <form
    className="flex flex-col items-center gap-2"
    onSubmit={(e) => {
      e.preventDefault();
      const name = (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value.trim();
      if (!NAME_PATTERN.test(name)) return;
      sessionStorage.setItem(STORAGE_KEY, name);
      window.location.assign('/');
    }}
  >
    <p role="status">Test login: pick a name (3-24 letters, digits, _ or .)</p>
    <input name="name" className="input input-bordered" placeholder="alice" autoFocus />
    <button type="submit" className="btn btn-primary btn-sm">
      Continue
    </button>
  </form>
);
export const SignIn = NeedsName;
export const SignUp = NeedsName;
