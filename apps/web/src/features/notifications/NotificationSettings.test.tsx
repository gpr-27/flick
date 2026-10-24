import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import { fakeApi, installFakeServices } from '../../../test/fakes';
import { NotificationSettings } from './NotificationSettings';

afterEach(removeFakePush);
beforeEach(() => {
  localStorage.clear();
});

const setup = (publicKey: string | null = 'AQID') => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) =>
    Promise.resolve(endpoint === ENDPOINTS.push.vapidKey ? { public_key: publicKey } : undefined),
  );
  installFakeServices(undefined, api);
  return api;
};

const pushSwitch = () => screen.getByRole('switch', { name: 'Push notifications' });

describe('NotificationSettings', () => {
  it('turns push on after a click and off again', async () => {
    const api = setup();
    installFakePush();
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(pushSwitch()).toBeEnabled();
    });

    await userEvent.click(pushSwitch());
    await waitFor(() => {
      expect(pushSwitch()).toBeChecked();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.subscribe, expect.anything());

    await userEvent.click(pushSwitch());
    await waitFor(() => {
      expect(pushSwitch()).not.toBeChecked();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.push.unsubscribe, expect.anything());
  });

  it('explains when the browser does not support push', async () => {
    setup();
    render(<NotificationSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent("can't receive push");
    expect(pushSwitch()).toBeDisabled();
  });

  it('explains when permission is blocked', async () => {
    setup();
    installFakePush({ permission: 'denied' });
    render(<NotificationSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('blocked');
    expect(pushSwitch()).toBeDisabled();
  });

  it('explains when the server has no VAPID key', async () => {
    setup(null);
    installFakePush();
    render(<NotificationSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent("aren't set up on this server");
    expect(pushSwitch()).toBeDisabled();
  });

  it('shows a denied message when the user rejects the browser prompt', async () => {
    setup();
    installFakePush({ answer: 'denied' });
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(pushSwitch()).toBeEnabled();
    });
    await userEvent.click(pushSwitch());
    expect(await screen.findByRole('alert')).toHaveTextContent('blocked');
    expect(pushSwitch()).not.toBeChecked();
  });

  it('remembers the sound toggle', async () => {
    setup();
    installFakePush();
    render(<NotificationSettings />);
    const sound = screen.getByRole('switch', { name: 'Message sound' });
    expect(sound).toBeChecked();
    await userEvent.click(sound);
    expect(sound).not.toBeChecked();
    expect(localStorage.getItem('flick-notification-prefs')).toBe('{"sound":false}');
  });
});
