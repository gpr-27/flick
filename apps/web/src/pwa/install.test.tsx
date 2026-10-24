import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallButton } from './InstallButton';
import { listenForInstall, promptInstall, useInstallStore } from './install';

let stop: () => void;
beforeEach(() => {
  useInstallStore.setState({ event: null, installed: false });
  stop = listenForInstall(window);
});
afterEach(() => {
  stop();
});

const fireInstallable = (outcome: 'accepted' | 'dismissed') => {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

describe('install prompt', () => {
  it('shows no button until the browser says the app is installable', () => {
    render(<InstallButton />);
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
    fireInstallable('accepted');
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument();
  });

  it('suppresses the browser mini-infobar and shows the dialog on click, once', async () => {
    render(<InstallButton />);
    const event = fireInstallable('accepted');
    expect(event.defaultPrevented).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /install/i }));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
    expect(await promptInstall()).toBe('unavailable');
  });

  it('hides the button once the app is installed', () => {
    render(<InstallButton />);
    fireInstallable('dismissed');
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
    expect(useInstallStore.getState().installed).toBe(true);
  });
});
