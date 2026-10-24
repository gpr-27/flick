// Session store and auth bridge: the device-id clash retry as a table, plus every plain path.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  getDeviceId,
  getSessionToken,
  resetDeviceId,
  setClerkBridge,
  signOutOfClerk,
} from './authBridge';
import { useSessionStore } from './useSessionStore';

const api = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/lib/services', () => ({ getApi: () => api }));

const me = { id: 'u1', username: 'alice' };
const apiError = (status: number, message: string, code = 'X') =>
  new ApiError({ status, code, message, retryable: false });

beforeEach(() => {
  localStorage.clear();
  resetDeviceId();
  api.call.mockReset();
  setClerkBridge(null);
  useSessionStore.getState().reset();
});

describe('session load: the device id clash', () => {
  // [name, first rejection, second outcome, calls, device id changes, final status]
  const table: [string, Error, 'me' | Error | null, number, boolean, string][] = [
    [
      '403 about the device id',
      apiError(403, 'This device id belongs to another user'),
      'me',
      2,
      true,
      'authenticated',
    ],
    [
      '403 about the Device ID (case)',
      apiError(403, 'DEVICE ID mismatch'),
      'me',
      2,
      true,
      'authenticated',
    ],
    ['403 for another reason', apiError(403, 'Account suspended'), null, 1, false, 'booting'],
    ['401', apiError(401, 'Sign in again'), null, 1, false, 'booting'],
    ['500', apiError(500, 'device id store is down'), null, 1, false, 'booting'],
    ['a network failure', new TypeError('Failed to fetch'), null, 1, false, 'booting'],
    [
      'clash twice: no endless loop',
      apiError(403, 'device id belongs to another'),
      apiError(403, 'device id belongs to another'),
      2,
      true,
      'booting',
    ],
  ];
  it.each(table)('%s', async (_name, first, second, calls, changes, status) => {
    const before = getDeviceId();
    api.call.mockRejectedValueOnce(first);
    if (second === 'me') api.call.mockResolvedValueOnce(me);
    else if (second instanceof Error) api.call.mockRejectedValueOnce(second);

    await useSessionStore.getState().load();

    expect(api.call).toHaveBeenCalledTimes(calls);
    expect(getDeviceId() !== before).toBe(changes);
    const state = useSessionStore.getState();
    expect(state.status).toBe(status);
    if (status === 'authenticated') expect(state.user).toEqual(me);
    else expect(state.error).toBeTruthy();
  });
});

describe('session store basics', () => {
  it('starts booting, loads, and exposes the user', async () => {
    api.call.mockResolvedValue(me);
    const pending = useSessionStore.getState().load();
    expect(useSessionStore.getState().status).toBe('booting');
    await pending;
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authenticated',
      user: me,
      error: null,
    });
  });

  it('a failed load stays "booting" with a message, and a retry clears it', async () => {
    api.call.mockRejectedValueOnce(new Error('offline'));
    await useSessionStore.getState().load();
    expect(useSessionStore.getState()).toMatchObject({ status: 'booting', user: null });
    expect(useSessionStore.getState().error).toBeTruthy();
    api.call.mockResolvedValueOnce(me);
    await useSessionStore.getState().load();
    expect(useSessionStore.getState()).toMatchObject({ status: 'authenticated', error: null });
  });

  it('reset signs out locally; setUser swaps the profile', () => {
    useSessionStore.setState({ status: 'authenticated', user: me as never });
    useSessionStore.getState().setUser({ ...me, username: 'alice2' } as never);
    expect(useSessionStore.getState().user).toMatchObject({ username: 'alice2' });
    useSessionStore.getState().reset();
    expect(useSessionStore.getState()).toMatchObject({ status: 'anonymous', user: null });
  });
});

describe('device id and auth bridge', () => {
  it('is generated once and stable', () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId()).toBe(first);
    expect(localStorage.getItem('flick.device_id')).toBe(first);
  });

  it('falls back to a per-page-load id when storage is blocked, and still resets', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const a = getDeviceId();
    expect(getDeviceId()).toBe(a);
    resetDeviceId();
    expect(getDeviceId()).not.toBe(a);
    get.mockRestore();
  });

  it("getSessionToken is null without a bridge and returns Clerk's token with one", async () => {
    expect(await getSessionToken()).toBeNull();
    setClerkBridge({ getToken: () => Promise.resolve('tok'), signOut: () => Promise.resolve() });
    expect(await getSessionToken()).toBe('tok');
    setClerkBridge({ getToken: () => Promise.resolve(null), signOut: () => Promise.resolve() });
    expect(await getSessionToken()).toBeNull();
  });

  it('signing out forgets the device id and calls Clerk', async () => {
    const signOut = vi.fn(() => Promise.resolve());
    setClerkBridge({ getToken: () => Promise.resolve('t'), signOut });
    const before = getDeviceId();
    await signOutOfClerk();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(getDeviceId()).not.toBe(before);
  });

  it('signing out without a bridge still forgets the device id', async () => {
    const before = getDeviceId();
    await expect(signOutOfClerk()).resolves.toBeUndefined();
    expect(getDeviceId()).not.toBe(before);
  });
});
