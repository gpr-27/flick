import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as PushModule from '@/features/notifications/push';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/notifications/push', async (importOriginal) => ({
  ...(await importOriginal<typeof PushModule>()),
  getPushState: vi.fn(),
  fetchVapidKey: vi.fn(),
  enablePush: vi.fn(),
}));

import { PushError, enablePush, fetchVapidKey, getPushState } from '@/features/notifications/push';
import { CallNotificationCard } from './CallNotificationCard';

beforeEach(() => {
  vi.mocked(getPushState).mockResolvedValue('unsubscribed');
  vi.mocked(fetchVapidKey).mockResolvedValue('public-key');
  vi.mocked(enablePush).mockResolvedValue(undefined);
});

describe('CallNotificationCard', () => {
  it('asks in context and never prompts until the button is clicked', async () => {
    const onDone = vi.fn();
    render(<CallNotificationCard onDone={onDone} />);
    expect(
      await screen.findByText('Allow notifications so you receive calls when Flick is closed.'),
    ).toBeInTheDocument();
    expect(enablePush).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Allow notifications' }));
    expect(enablePush).toHaveBeenCalledWith('public-key');
    expect(onDone).toHaveBeenCalled();
    expect(await screen.findByText(/best-effort/)).toBeInTheDocument();
  });

  it('shows recovery steps when the browser says no', async () => {
    vi.mocked(enablePush).mockRejectedValue(new PushError('denied', 'blocked'));
    render(<CallNotificationCard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow notifications' }));
    expect(await screen.findByText('Notifications are blocked')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the steps at once when notifications were already blocked', async () => {
    vi.mocked(getPushState).mockResolvedValue('denied');
    render(<CallNotificationCard />);
    expect(await screen.findByText('Notifications are blocked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow notifications' })).toBeNull();
  });

  it('shows nothing when the server cannot send pushes', async () => {
    vi.mocked(fetchVapidKey).mockResolvedValue(null);
    const { container } = render(<CallNotificationCard />);
    await vi.waitFor(() => {
      expect(fetchVapidKey).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});
