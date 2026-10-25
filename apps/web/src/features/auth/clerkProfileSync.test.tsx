// One place to edit a name: Flick follows Clerk's account menu, Clerk follows the Flick profile
// page, neither starts a loop, and a taken username keeps Flick's. Real Clerk is mocked.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { ApiError } from '@/lib/api';

const clerk = vi.hoisted(() => ({
  state: { isLoaded: true, user: null as object | null },
}));
vi.mock('@clerk/clerk-react', () => ({ useUser: () => clerk.state }));
const toast = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock('@/components/ui/notify', () => ({ notify: toast }));

import { ME, installFakeServices, type FakeApi } from '../../../test/fakes';
import {
  clerkIdentity,
  planClerkToFlick,
  pushProfileToClerk,
  readSnapshot,
  setClerkUser,
  splitName,
  writeSnapshot,
  type ClerkUserLike,
} from './clerkProfileSync';
import { useClerkProfileSync } from './useClerkProfileSync';
import { useSessionStore, type Me } from './useSessionStore';

let api: FakeApi;

const flickMe = (over: Partial<Me> = {}): Me => ({
  id: ME,
  username: 'alice',
  email: 'a@x.test',
  display_name: 'Alice Smith',
  about: null,
  avatar_url: null,
  is_demo: false,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const fakeClerkUser = (over: Partial<ClerkUserLike> = {}): ClerkUserLike => ({
  id: 'user_1',
  firstName: 'Alice',
  lastName: 'Smith',
  username: 'alice',
  update: vi.fn(() => Promise.resolve(undefined)),
  setProfileImage: vi.fn(() => Promise.resolve({})),
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  setClerkUser(null);
  clerk.state = { isLoaded: true, user: null };
  useSessionStore.setState({ user: flickMe(), status: 'authenticated' });
});

describe('splitName', () => {
  it('uses the first word as first name and the rest as last name', () => {
    expect(splitName('Mary Ann  Smith')).toEqual({ firstName: 'Mary', lastName: 'Ann Smith' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
    expect(clerkIdentity({ firstName: 'Mary', lastName: 'Ann Smith', username: 'A_B' })).toEqual({
      name: 'Mary Ann Smith',
      username: 'a_b',
    });
  });
});

describe('planClerkToFlick', () => {
  const flick = { name: 'Alice Smith', username: 'alice' };
  const snap = { name: 'Alice Smith', username: 'alice' };

  it('copies nothing the first time: it only takes a snapshot', () => {
    expect(planClerkToFlick({ name: 'Other', username: 'other' }, flick, null)).toEqual({
      patch: {},
      firstRun: true,
    });
  });

  it('copies a name or username that changed in Clerk', () => {
    expect(planClerkToFlick({ name: 'Alicia', username: 'alice' }, flick, snap).patch).toEqual({
      display_name: 'Alicia',
    });
    expect(planClerkToFlick({ name: 'Alice Smith', username: 'al_2' }, flick, snap).patch).toEqual({
      username: 'al_2',
    });
  });

  it('never overwrites a name chosen in Flick while Clerk is unchanged', () => {
    const chosenInFlick = { name: 'Alice Brand New', username: 'alice' };
    expect(
      planClerkToFlick({ name: 'Alice Smith', username: 'alice' }, chosenInFlick, snap).patch,
    ).toEqual({});
  });

  it('skips blank names and invalid usernames', () => {
    expect(planClerkToFlick({ name: '', username: 'a b' }, flick, snap).patch).toEqual({});
  });

  it('does not copy a value Flick already has', () => {
    expect(
      planClerkToFlick({ name: 'Alicia', username: 'alice' }, { ...flick, name: 'Alicia' }, snap)
        .patch,
    ).toEqual({});
  });
});

describe('Flick -> Clerk (the profile page saved)', () => {
  it('updates the Clerk name and username and remembers the new snapshot', async () => {
    const user = fakeClerkUser();
    setClerkUser(user);
    const result = await pushProfileToClerk(ME, { name: 'Alicia Jones', username: 'Alicia_J' });
    expect(result).toBe('ok');
    expect(user.update).toHaveBeenCalledWith({ firstName: 'Alicia', lastName: 'Jones' });
    expect(user.update).toHaveBeenCalledWith({ username: 'alicia_j' });
    expect(readSnapshot(ME)).toEqual({ name: 'Alicia Jones', username: 'alicia_j' });
  });

  it('sends nothing Clerk already has, and no username when Clerk has none', async () => {
    const user = fakeClerkUser({ username: null });
    setClerkUser(user);
    await pushProfileToClerk(ME, { name: 'Alice Smith', username: 'alice' });
    expect(user.update).not.toHaveBeenCalled();
    await pushProfileToClerk(ME, { name: 'Alicia', username: 'new_name' });
    expect(user.update).toHaveBeenCalledTimes(1);
    expect(user.update).toHaveBeenCalledWith({ firstName: 'Alicia', lastName: '' });
  });

  it('copies a new or removed photo', async () => {
    const user = fakeClerkUser();
    setClerkUser(user);
    const blob = new Blob(['x']);
    await pushProfileToClerk(ME, { name: 'Alice Smith', username: 'alice', photo: blob });
    await pushProfileToClerk(ME, { name: 'Alice Smith', username: 'alice', photo: null });
    expect(user.setProfileImage).toHaveBeenNthCalledWith(1, { file: blob });
    expect(user.setProfileImage).toHaveBeenNthCalledWith(2, { file: null });
  });

  it('reports a Clerk failure without throwing and keeps the old snapshot', async () => {
    writeSnapshot(ME, { name: 'Alice Smith', username: 'alice' });
    setClerkUser(fakeClerkUser({ update: vi.fn(() => Promise.reject(new Error('nope'))) }));
    expect(await pushProfileToClerk(ME, { name: 'Alicia', username: 'alice' })).toBe('failed');
    expect(readSnapshot(ME)).toEqual({ name: 'Alice Smith', username: 'alice' });
  });

  it('is skipped when there is no Clerk user (the test login)', async () => {
    expect(await pushProfileToClerk(ME, { name: 'A', username: 'alice' })).toBe('skipped');
  });
});

describe('Clerk -> Flick (the account menu changed)', () => {
  const mount = (user: ClerkUserLike) => {
    clerk.state = { isLoaded: true, user };
    return renderHook(() => useClerkProfileSync());
  };
  const patchCalls = () => api.call.mock.calls.filter(([e]) => e === ENDPOINTS.users.updateMe);

  it('takes a snapshot on first sight and changes nothing', async () => {
    mount(fakeClerkUser({ firstName: 'Somebody', lastName: 'Else' }));
    await waitFor(() => {
      expect(readSnapshot(ME)).toEqual({ name: 'Somebody Else', username: 'alice' });
    });
    expect(patchCalls()).toHaveLength(0);
  });

  it('copies a name changed in Clerk into Flick, once, with no loop', async () => {
    writeSnapshot(ME, { name: 'Alice Smith', username: 'alice' });
    api.call.mockResolvedValue(flickMe({ display_name: 'Alicia Jones' }));
    const user = fakeClerkUser({ firstName: 'Alicia', lastName: 'Jones' });
    const view = mount(user);
    await waitFor(() => {
      expect(useSessionStore.getState().user?.display_name).toBe('Alicia Jones');
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updateMe, {
      body: { display_name: 'Alicia Jones' },
    });
    expect(readSnapshot(ME)).toEqual({ name: 'Alicia Jones', username: 'alice' });
    // Clerk is re-read (it saw an update) and Flick changed: still exactly one PATCH, no write to Clerk.
    view.rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(patchCalls()).toHaveLength(1);
    expect(user.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a name chosen in Flick when Clerk did not change', async () => {
    writeSnapshot(ME, { name: 'Alice Smith', username: 'alice' });
    useSessionStore.setState({ user: flickMe({ display_name: 'Chosen In Flick' }) });
    mount(fakeClerkUser());
    await act(async () => {
      await Promise.resolve();
    });
    expect(patchCalls()).toHaveLength(0);
  });

  it('does not treat our own push to Clerk as a Clerk edit', async () => {
    const user = fakeClerkUser();
    const view = mount(user);
    await waitFor(() => {
      expect(readSnapshot(ME)).not.toBeNull();
    });
    await pushProfileToClerk(ME, { name: 'Alicia Jones', username: 'alice' });
    useSessionStore.setState({ user: flickMe({ display_name: 'Alicia Jones' }) });
    // Clerk now reports the new name, as the real one does after update().
    clerk.state = {
      isLoaded: true,
      user: { ...user, firstName: 'Alicia', lastName: 'Jones' },
    };
    view.rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(patchCalls()).toHaveLength(0);
  });

  it('keeps the Flick username when Clerk’s is taken, says why, and sets Clerk back', async () => {
    writeSnapshot(ME, { name: 'Alice Smith', username: 'alice' });
    api.call.mockImplementation((_e: unknown, opts: unknown) => {
      const body = (opts as { body: { username?: string } }).body;
      return body.username
        ? Promise.reject(
            new ApiError({ status: 409, code: 'CONFLICT', message: 'That username is taken' }),
          )
        : Promise.resolve(flickMe({ display_name: 'Alicia Jones' }));
    });
    const user = fakeClerkUser({ firstName: 'Alicia', lastName: 'Jones', username: 'popular' });
    mount(user);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(String(toast.error.mock.calls[0]?.[0])).toContain('@popular');
    expect(String(toast.error.mock.calls[0]?.[0])).toContain('stays @alice');
    await waitFor(() => {
      expect(useSessionStore.getState().user?.display_name).toBe('Alicia Jones');
    });
    expect(useSessionStore.getState().user?.username).toBe('alice');
    expect(user.update).toHaveBeenCalledWith({ username: 'alice' });
    expect(readSnapshot(ME)).toEqual({ name: 'Alicia Jones', username: 'alice' });
  });

  it('does nothing while Clerk is loading or has no user', async () => {
    clerk.state = { isLoaded: false, user: null };
    renderHook(() => useClerkProfileSync());
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.call).not.toHaveBeenCalled();
  });
});
