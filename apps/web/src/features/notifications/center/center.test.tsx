import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS, type NotificationItem } from '@chat/contracts';
import { fakeApi, FakeTransport, installFakeServices } from '../../../../test/fakes';
import { useJumpStore } from '@/features/organise/jump';
import { groupByDay } from './dayGroups';
import { BellLink } from './BellLink';
import { NotificationsPage } from './NotificationsPage';
import { useNotificationBindings } from './useNotificationBindings';
import { useNotificationStore } from './useNotificationStore';

const item = (over: Partial<NotificationItem>): NotificationItem => ({
  id: '0192f5a0-0000-7000-8000-000000000001',
  kind: 'message',
  created_at: new Date().toISOString(),
  read: false,
  conversation_id: '0192f5a0-0000-7000-8000-0000000000c1',
  message_id: '0192f5a0-0000-7000-8000-0000000000a1',
  seq: 5,
  available: true,
  sender_name: 'Bob',
  sender_avatar_url: null,
  chat_name: 'Bob',
  is_group: false,
  preview: 'hello there',
  ...over,
});

const setup = (items: NotificationItem[]) => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) => {
    if (endpoint === ENDPOINTS.notifications.list)
      return Promise.resolve({
        items,
        next_cursor: null,
        unread_count: items.filter((i) => !i.read).length,
      });
    if (endpoint === ENDPOINTS.notifications.unread)
      return Promise.resolve({ unread_count: items.length });
    return Promise.resolve({ unread_count: 0 });
  });
  const transport = new FakeTransport();
  installFakeServices(transport, api);
  return { api, transport };
};

beforeEach(() => {
  useNotificationStore.getState().reset();
  useJumpStore.setState({ target: null });
});

describe('notification centre', () => {
  it('lists alerts by day with tags and unread marks, and a tap opens the message', async () => {
    const mention = item({ kind: 'mention' });
    setup([mention, item({ id: 'b', read: true, preview: 'older' })]);
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Mention')).toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();

    await userEvent.click(screen.getByText('hello there'));
    expect(useJumpStore.getState().target).toMatchObject({ messageId: mention.message_id, seq: 5 });
    expect(useNotificationStore.getState().unread).toBe(0);
  });

  it('marks everything read and clears', async () => {
    const { api } = setup([item({})]);
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.notifications.markRead, {
      body: { all: true },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to clear' }));
    await waitFor(() => {
      expect(api.call).toHaveBeenCalledWith(ENDPOINTS.notifications.clear);
    });
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('shows a dot on the bell that follows the unread count, live', async () => {
    const { transport } = setup([item({})]);
    const Harness = () => {
      useNotificationBindings('u1');
      return (
        <MemoryRouter>
          <BellLink />
        </MemoryRouter>
      );
    };
    render(<Harness />);
    expect(await screen.findByTestId('bell-dot')).toBeInTheDocument();

    useNotificationStore.getState().reset();
    await waitFor(() => {
      expect(screen.queryByTestId('bell-dot')).not.toBeInTheDocument();
    });
    transport.fire('notification_created', {
      id: 'x',
      kind: 'message',
      conversation_id: null,
      message_id: null,
      created_at: new Date().toISOString(),
    });
    expect(await screen.findByTestId('bell-dot')).toBeInTheDocument();
  });

  it('groups by day, newest first', () => {
    const old = item({ id: 'o', created_at: '2020-01-02T10:00:00.000Z' });
    expect(groupByDay([item({}), old]).map((g) => g.label)).toEqual(['Today', '2 Jan']);
  });
});
