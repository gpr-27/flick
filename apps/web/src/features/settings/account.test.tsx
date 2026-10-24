import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { ME, fakeApi, installFakeServices } from '../../../test/fakes';
import * as bridge from '../auth/authBridge';
import { useSessionStore } from '../auth/useSessionStore';
import { AccountSection } from './components/AccountSection';
import { exportFileName } from './exportData';
import * as exportData from './exportData';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const device = (id: string, name: string, current = false) => ({
  id,
  name,
  platform: 'web',
  created_at: '2026-01-01T00:00:00.000Z',
  last_active_at: '2026-01-02T10:00:00.000Z',
  current,
});

let api: ReturnType<typeof fakeApi>;
beforeEach(() => {
  api = fakeApi();
  api.call.mockImplementation((e) =>
    Promise.resolve(
      e === ENDPOINTS.devices.list
        ? { items: [device('d1', 'Chrome on macOS', true), device('d2', 'Safari on iOS')] }
        : undefined,
    ),
  );
  installFakeServices(undefined, api);
  useSessionStore.setState({
    status: 'authenticated',
    user: { id: ME, username: 'sam', display_name: 'Sam', email: 'sam@example.com' } as never,
  });
});

const view = () =>
  render(
    <MemoryRouter>
      <AccountSection />
    </MemoryRouter>,
  );

describe('devices', () => {
  it('lists the devices and marks this one', async () => {
    view();
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
    // only the other device can be signed out
    expect(screen.getAllByRole('button', { name: /^Sign out / })).toHaveLength(2); // the device + "other devices"
  });

  it('signs a device out and removes it from the list', async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Sign out Safari on iOS' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.devices.revoke, {
      params: { device_id: 'd2' },
    });
    await waitFor(() => {
      expect(screen.queryByText('Safari on iOS')).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'Sign out of other devices' }),
    ).not.toBeInTheDocument();
  });

  it('signs out of all other devices at once', async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Sign out of other devices' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.devices.revokeOthers);
    await waitFor(() => {
      expect(screen.queryByText('Safari on iOS')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
  });
});

describe('delete account', () => {
  const open = async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    return { user, dialog };
  };

  it('stays disabled until the exact username is typed', async () => {
    const { user, dialog } = await open();
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type sam to confirm/), 'sa');
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type sam to confirm/), 'm');
    expect(confirm).toBeEnabled();
  });

  it('deletes, then signs out of Clerk', async () => {
    const signOut = vi.spyOn(bridge, 'signOutOfClerk').mockResolvedValue();
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/Type sam to confirm/), 'sam');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.deleteAccount, {
      body: { username: 'sam' },
    });
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('stays signed in when the server refuses', async () => {
    const signOut = vi.spyOn(bridge, 'signOutOfClerk').mockResolvedValue();
    api.call.mockImplementation((e) =>
      e === ENDPOINTS.users.deleteAccount
        ? Promise.reject(new Error('nope'))
        : Promise.resolve({ items: [] }),
    );
    const { user, dialog } = await open();
    await user.type(within(dialog).getByLabelText(/Type sam to confirm/), 'sam');
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Delete account' })).toBeEnabled();
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(useSessionStore.getState().user).not.toBeNull();
  });
});

describe('data export', () => {
  it('the button downloads the file the server sends', async () => {
    const saved: { name: string; text: string }[] = [];
    vi.spyOn(exportData, 'downloadMyData').mockImplementation(() => {
      saved.push({ name: 'flick-export-2026-01-01.json', text: '{}' });
      return Promise.resolve();
    });
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(saved).toHaveLength(1);
  });

  it('reads the file name from Content-Disposition', () => {
    expect(exportFileName('attachment; filename="flick-export-2026-05-01.json"')).toBe(
      'flick-export-2026-05-01.json',
    );
    expect(exportFileName(null)).toBe('flick-export.json');
  });

  it('downloadMyData sends the token and device id and hands the blob to save', async () => {
    vi.spyOn(bridge, 'getSessionToken').mockResolvedValue('tok');
    vi.spyOn(bridge, 'getDeviceId').mockReturnValue('dev-1');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"chats":[]}', {
        headers: { 'content-disposition': 'attachment; filename="flick-export-x.json"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const save = vi.fn();
    await exportData.downloadMyData(save);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/\/users\/me\/export$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Device-Id': 'dev-1' });
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'flick-export-x.json');
    vi.unstubAllGlobals();
  });

  it('downloadMyData fails clearly when the server says no', async () => {
    vi.spyOn(bridge, 'getSessionToken').mockResolvedValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    await expect(exportData.downloadMyData(vi.fn())).rejects.toThrow('401');
    vi.unstubAllGlobals();
  });
});
