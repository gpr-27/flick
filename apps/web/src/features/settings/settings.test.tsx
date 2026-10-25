import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { BOB, fakeApi, installFakeServices } from '../../../test/fakes';
import { BlockedUsers } from './components/BlockedUsers';
import { PrivacySettings } from './components/PrivacySettings';
import { ReportDialog } from './components/ReportDialog';

const privacy = {
  last_seen: 'everyone',
  profile_photo: 'everyone',
  about: 'everyone',
  groups_add: 'everyone',
  read_receipts: true,
  ai_language: null,
};

describe('PrivacySettings', () => {
  it('loads the settings and saves a change', async () => {
    const api = fakeApi();
    api.call.mockImplementation((endpoint, args) =>
      Promise.resolve(
        endpoint === ENDPOINTS.users.updateSettings
          ? { ...privacy, ...(args as { body: object }).body }
          : privacy,
      ),
    );
    installFakeServices(undefined, api);
    render(<PrivacySettings />);

    const lastSeen = await screen.findByRole('combobox', { name: 'Last seen and online' });
    expect(lastSeen).toHaveValue('everyone');
    await userEvent.selectOptions(lastSeen, 'nobody');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updateSettings, {
      body: { last_seen: 'nobody' },
    });
    await waitFor(() => {
      expect(lastSeen).toHaveValue('nobody');
    });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Who can add me to groups' }),
      'nobody',
    );
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updateSettings, {
      body: { groups_add: 'nobody' },
    });

    await userEvent.click(screen.getByRole('switch', { name: 'Read receipts' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.updateSettings, {
      body: { read_receipts: false },
    });
  });

  it('puts the old value back when saving fails', async () => {
    const api = fakeApi();
    api.call.mockImplementation((endpoint) =>
      endpoint === ENDPOINTS.users.updateSettings
        ? Promise.reject(new Error('nope'))
        : Promise.resolve(privacy),
    );
    installFakeServices(undefined, api);
    render(<PrivacySettings />);
    const select = await screen.findByRole('combobox', { name: 'About' });
    await userEvent.selectOptions(select, 'nobody');
    await waitFor(() => {
      expect(select).toHaveValue('everyone');
    });
  });
});

const blocked = {
  items: [
    {
      user: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
      blocked_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  next_cursor: null,
};

describe('BlockedUsers', () => {
  it('lists blocked users and unblocks one', async () => {
    const api = fakeApi();
    api.call.mockImplementation((endpoint) =>
      Promise.resolve(endpoint === ENDPOINTS.moderation.blocks ? blocked : undefined),
    );
    installFakeServices(undefined, api);
    render(<BlockedUsers />);

    await userEvent.click(await screen.findByRole('button', { name: 'Unblock Bob' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.unblock, {
      params: { user_id: BOB },
    });
    expect(await screen.findByText('You have not blocked anyone.')).toBeInTheDocument();
  });

  it('reports a blocked user through the moderation endpoint', async () => {
    const api = fakeApi();
    api.call.mockImplementation((endpoint) =>
      Promise.resolve(endpoint === ENDPOINTS.moderation.blocks ? blocked : { report_id: 'r1' }),
    );
    installFakeServices(undefined, api);
    render(<BlockedUsers />);

    await userEvent.click(await screen.findByRole('button', { name: 'Report' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'harassment');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.report, {
      body: { user_id: BOB, reason: 'harassment', block: false },
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('ReportDialog', () => {
  it('reports a message', async () => {
    const api = fakeApi();
    installFakeServices(undefined, api);
    render(
      <ReportDialog
        target={{ conversation_id: 'c1', message_id: 'm1' }}
        onClose={() => undefined}
      />,
    );
    await userEvent.type(screen.getByLabelText(/Details/), 'rude');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.moderation.report, {
      body: {
        conversation_id: 'c1',
        message_id: 'm1',
        reason: 'spam',
        block: false,
        details: 'rude',
      },
    });
  });
});
