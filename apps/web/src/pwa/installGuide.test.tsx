import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallButton } from './InstallButton';
import { InstallCard } from './InstallCard';
import { InstallGuide } from './InstallGuide';
import {
  installModeFor,
  isAndroid,
  isInAppBrowser,
  isIos,
  openInstallGuide,
  startInstall,
  useInstallStore,
} from './install';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const INSTAGRAM = `${IPHONE} Instagram 300.0`;
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const setUserAgent = (ua: string, touchPoints = 0) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  // jsdom has no maxTouchPoints, so it is defined here (and removed again after each test).
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: touchPoints });
};
const setStandalone = (on: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: on && q.includes('standalone'),
      addEventListener() {},
      removeEventListener() {},
    }),
  });
};

beforeEach(() => {
  useInstallStore.setState({ event: null, installed: false, guideOpen: false });
  localStorage.clear();
  setStandalone(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'maxTouchPoints');
});

describe('device detection', () => {
  it('recognises iPhones, iPads that pose as a Mac, and Android', () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IPAD_AS_MAC, 5)).toBe(true); // a touch screen gives an iPad away
    expect(isIos(IPAD_AS_MAC, 0)).toBe(false); // a real Mac has no touch screen
    expect(isAndroid(ANDROID_CHROME)).toBe(true);
    expect(isAndroid(IPHONE)).toBe(false);
  });

  it('spots browsers inside other apps, which cannot install web apps', () => {
    expect(isInAppBrowser(INSTAGRAM)).toBe(true);
    expect(isInAppBrowser(IPHONE)).toBe(false);
  });
});

describe('install mode', () => {
  it('uses the browser dialog when there is one, the steps on phones without it, nothing on desktop', () => {
    setUserAgent(ANDROID_CHROME, 5);
    const event = new Event('beforeinstallprompt') as never;
    expect(installModeFor({ event, installed: false })).toBe('prompt');

    setUserAgent(IPHONE, 5);
    expect(installModeFor({ event: null, installed: false })).toBe('guide');

    setUserAgent(DESKTOP, 0);
    expect(installModeFor({ event: null, installed: false })).toBe('none');
  });

  it('offers nothing once the app is installed or already running as one', () => {
    setUserAgent(IPHONE, 5);
    expect(installModeFor({ event: null, installed: true })).toBe('none');
    setStandalone(true);
    expect(installModeFor({ event: null, installed: false })).toBe('none');
  });
});

describe('install on an iPhone (no browser dialog)', () => {
  it('shows the Install button, which opens the Add to Home Screen steps', async () => {
    setUserAgent(IPHONE, 5);
    const user = userEvent.setup();
    render(
      <>
        <InstallButton />
        <InstallGuide />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /install app/i }));
    expect(await screen.findByText('Add to Home Screen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText('Add to Home Screen')).not.toBeInTheDocument();
  });

  it('tells people in an in-app browser to open Safari first', () => {
    setUserAgent(INSTAGRAM, 5);
    act(() => {
      openInstallGuide();
    });
    render(<InstallGuide />);
    expect(screen.getByText(/Open in Safari/)).toBeInTheDocument();
  });

  it('startInstall opens the steps when the browser gave no dialog', async () => {
    await startInstall();
    expect(useInstallStore.getState().guideOpen).toBe(true);
  });
});

describe('install card on the chat list', () => {
  it('shows on a phone, and closing it keeps it away for two weeks', async () => {
    setUserAgent(ANDROID_CHROME, 5);
    const user = userEvent.setup();
    const { unmount } = render(<InstallCard />);
    expect(screen.getByText(/Install Flick/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide the install suggestion' }));
    expect(screen.queryByText(/Install Flick/)).not.toBeInTheDocument();
    unmount();

    render(<InstallCard />); // next visit
    expect(screen.queryByText(/Install Flick/)).not.toBeInTheDocument();
  });

  it('comes back after the quiet period', () => {
    setUserAgent(ANDROID_CHROME, 5);
    localStorage.setItem(
      'flick.install_card_dismissed_at',
      String(Date.now() - 15 * 24 * 60 * 60 * 1000),
    );
    render(<InstallCard />);
    expect(screen.getByText(/Install Flick/)).toBeInTheDocument();
  });

  it('is not shown on a desktop browser or once installed', () => {
    setUserAgent(DESKTOP, 0);
    const { unmount } = render(<InstallCard />);
    expect(screen.queryByText(/Install Flick/)).not.toBeInTheDocument();
    unmount();

    setUserAgent(IPHONE, 5);
    setStandalone(true);
    render(<InstallCard />);
    expect(screen.queryByText(/Install Flick/)).not.toBeInTheDocument();
  });
});
