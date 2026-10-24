import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/lib/api';
import { getDeviceId, resetDeviceId, setClerkBridge, signOutOfClerk } from './authBridge';
import { SignInPage } from './components/SignInPage';
import { getSocketAuth } from './socketAuth';

const clerk = vi.hoisted(() => ({ signedIn: false }));

vi.mock('@clerk/clerk-react', () => ({
  SignIn: () => <div>clerk-sign-in</div>,
  SignUp: () => <div>clerk-sign-up</div>,
  SignedOut: ({ children }: { children: React.ReactNode }) => (clerk.signedIn ? null : children),
  SignedIn: ({ children }: { children: React.ReactNode }) => (clerk.signedIn ? children : null),
}));

const json = (status: number): Response =>
  new Response('{}', { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  setClerkBridge({ getToken: () => Promise.resolve('clerk-token'), signOut: vi.fn() });
});

describe('signed-out view', () => {
  it('shows Clerk sign-in', () => {
    clerk.signedIn = false;
    render(<SignInPage />);
    expect(screen.getByText('clerk-sign-in')).toBeInTheDocument();
  });
});

describe('device id reset', () => {
  it('gives the next account on this browser a new device id', async () => {
    const first = getDeviceId();
    await signOutOfClerk();
    const second = getDeviceId();
    expect(second).not.toBe(first);
    resetDeviceId();
    expect(getDeviceId()).not.toBe(second);
  });
});

describe('device id', () => {
  it('is generated once and stays stable', () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId()).toBe(first);
    expect(localStorage.getItem('flick.device_id')).toBe(first);
  });
});

describe('API client with Clerk', () => {
  it('attaches the bearer token and X-Device-Id, and signs out on 401', async () => {
    const signOut = vi.fn(() => Promise.resolve());
    setClerkBridge({ getToken: () => Promise.resolve('clerk-token'), signOut });
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(json(200)),
    );
    const api = createApiClient({
      baseUrl: 'http://x',
      getToken: () => Promise.resolve('clerk-token'),
      getDeviceId,
      onUnauthorized: () => void signOutOfClerk(),
      fetch,
    });

    await api.get('/a', (d) => d);
    await api.get('/b', (d) => d);
    const headers = fetch.mock.calls.map(([, init]) => init?.headers as Record<string, string>);
    expect(headers[0]).toMatchObject({
      Authorization: 'Bearer clerk-token',
      'X-Device-Id': getDeviceId(),
    });
    expect(headers[1]!['X-Device-Id']).toBe(headers[0]!['X-Device-Id']);

    fetch.mockResolvedValueOnce(json(401));
    await expect(api.get('/c', (d) => d)).rejects.toMatchObject({ status: 401 });
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe('getSocketAuth', () => {
  it('returns the Clerk token and the device id', async () => {
    await expect(getSocketAuth()).resolves.toEqual({
      token: 'clerk-token',
      deviceId: getDeviceId(),
    });
  });

  it('rejects when signed out', async () => {
    setClerkBridge(null);
    await expect(getSocketAuth()).rejects.toThrow('Not signed in');
  });
});
