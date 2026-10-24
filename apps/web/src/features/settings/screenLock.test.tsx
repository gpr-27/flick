import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPasscode } from '../organise/lock';
import { AppLock } from './components/AppLock';
import { ScreenLockSettings } from './components/ScreenLockSettings';
import { PIN_PATTERN, hashPin, pinMatches, useAppLock } from './screenLock';
import { useSettingsStore } from './useSettingsStore';

vi.mock('@/components/ui/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSettingsStore.getState().reset();
  useAppLock.setState({ unlocked: false });
});

describe('PIN hashing', () => {
  it('reuses the chat lock hashing with its own salt name', async () => {
    expect(await hashPin('1234')).toBe(await hashPasscode('flick-app-lock', '1234'));
    expect(await hashPin('1234')).not.toBe(await hashPin('1235'));
    expect(await hashPin('1234')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pinMatches checks the shape and the hash', async () => {
    const hash = await hashPin('4321');
    expect(await pinMatches('4321', hash)).toBe(true);
    expect(await pinMatches('4322', hash)).toBe(false);
    expect(await pinMatches('4321', null)).toBe(false);
    expect(await pinMatches('12', hash)).toBe(false);
    expect(PIN_PATTERN.test('123')).toBe(false);
    expect(PIN_PATTERN.test('12345678')).toBe(true);
    expect(PIN_PATTERN.test('12a4')).toBe(false);
  });
});

describe('AppLock', () => {
  it('shows nothing without a PIN', () => {
    render(<AppLock />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('covers the app until the right PIN is typed', async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().update({ screenLockHash: await hashPin('2468') });
    render(<AppLock />);
    expect(screen.getByRole('dialog', { name: 'Flick is locked' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('PIN'), '1111');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.type(screen.getByLabelText('PIN'), '2468');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem('flick:app-unlocked')).toBe('1');
  });
});

describe('ScreenLockSettings', () => {
  it('sets a PIN (checking both entries), then turns it off with the PIN', async () => {
    const user = userEvent.setup();
    render(<ScreenLockSettings />);
    await user.click(screen.getByRole('button', { name: 'Set a PIN' }));

    await user.type(screen.getByLabelText(/New PIN/), '12');
    await user.type(screen.getByLabelText('Type it again'), '12');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 to 8 digits');

    await user.clear(screen.getByLabelText(/New PIN/));
    await user.type(screen.getByLabelText(/New PIN/), '1357');
    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), '1358');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different');

    await user.clear(screen.getByLabelText('Type it again'));
    await user.type(screen.getByLabelText('Type it again'), '1357');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(useSettingsStore.getState().screenLockHash).toMatch(/^[0-9a-f]{64}$/);
    });
    expect(screen.getByRole('button', { name: 'Lock now' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Current PIN'), '0000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not right');
    expect(useSettingsStore.getState().screenLockHash).not.toBeNull();

    await user.clear(screen.getByLabelText('Current PIN'));
    await user.type(screen.getByLabelText('Current PIN'), '1357');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(useSettingsStore.getState().screenLockHash).toBeNull();
    });
  });
});
