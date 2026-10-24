import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  fakeToken,
  resolveFakeUser,
  useAuth,
} from './fakeClerk';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

describe('fake auth (test seam)', () => {
  afterEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('takes the name from ?as= and remembers it for reloads', () => {
    const storage = memory();
    expect(resolveFakeUser('?as=alice', storage)).toBe('alice');
    expect(resolveFakeUser('', storage)).toBe('alice');
  });

  it('ignores names the API would refuse', () => {
    expect(resolveFakeUser('?as=a b', memory())).toBeNull();
    expect(resolveFakeUser('?as=ab', memory())).toBeNull();
  });

  it('uses the fake:<name> token', () => {
    expect(fakeToken('bob')).toBe('fake:bob');
  });

  it('shows the signed-in side and hands out the token', async () => {
    window.history.replaceState(null, '', '/?as=carol');
    const Probe = () => {
      const { getToken } = useAuth();
      return <button onClick={() => void getToken().then((t) => (document.title = t ?? ''))} />;
    };
    render(
      <ClerkProvider>
        <SignedIn>
          <p>in</p>
        </SignedIn>
        <SignedOut>
          <p>out</p>
        </SignedOut>
        <Probe />
      </ClerkProvider>,
    );
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(screen.queryByText('out')).toBeNull();
    screen.getByRole('button').click();
    await waitFor(() => {
      expect(document.title).toBe('fake:carol');
    });
  });
});
