// Wording and rules for asking permission to ring when Flick is closed. Pure, so it is tested
// without a browser. The permission prompt itself is only ever shown after a click.
import type { PushState } from '@/features/notifications/push';

export type Platform = 'ios' | 'android' | 'desktop';

export interface PlatformInfo {
  userAgent: string;
  /** True when Flick runs as an installed app (home-screen icon), not in a browser tab. */
  standalone: boolean;
  maxTouchPoints: number;
}

export const platformOf = ({ userAgent, maxTouchPoints }: PlatformInfo): Platform => {
  // iPadOS reports itself as a Mac, but has a touch screen.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1))
    return 'ios';
  return /Android/.test(userAgent) ? 'android' : 'desktop';
};

export const currentPlatformInfo = (): PlatformInfo => ({
  userAgent: navigator.userAgent,
  maxTouchPoints: navigator.maxTouchPoints,
  standalone:
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true,
});

/** How to switch notifications back on after they were blocked. Browsers do not let a page do it. */
export const DENIED_STEPS: Record<Platform, string[]> = {
  ios: [
    'Open the Settings app on your iPhone or iPad.',
    'Tap Notifications, then Flick.',
    'Turn on Allow Notifications, then come back here.',
  ],
  android: [
    'Tap the lock icon (or the three dots, then Site settings) next to the address.',
    'Open Notifications and choose Allow.',
    'Reload Flick.',
  ],
  desktop: [
    'Click the lock icon next to the address bar.',
    'Set Notifications to Allow.',
    'Reload Flick.',
  ],
};

export type CallPermissionView =
  | { kind: 'loading' }
  | { kind: 'enabled'; text: string }
  | { kind: 'ask'; title: string; text: string; button: string }
  | { kind: 'denied'; title: string; text: string; steps: string[] }
  | { kind: 'install'; title: string; text: string }
  | { kind: 'unsupported'; title: string; text: string };

const ASK_TEXT = 'Allow notifications so you receive calls when Flick is closed.';

/**
 * What the card should show. iPhones and iPads only deliver web push to an app that was added to
 * the Home Screen (iOS 16.4 and later), so in a Safari tab the honest advice is to install first.
 */
export const describeCallPermission = (
  state: PushState | 'loading',
  info: PlatformInfo,
): CallPermissionView => {
  if (state === 'loading') return { kind: 'loading' };
  if (state === 'subscribed') {
    return {
      kind: 'enabled',
      text: 'Calls can reach you when Flick is closed. A notification with Answer and Decline appears; delivery is best-effort and it does not ring like a phone.',
    };
  }
  const platform = platformOf(info);
  if (state === 'denied') {
    return {
      kind: 'denied',
      title: 'Notifications are blocked',
      text: 'Flick cannot tell you about calls while it is closed. To fix it:',
      steps: DENIED_STEPS[platform],
    };
  }
  if (state === 'unsupported') {
    if (platform === 'ios' && !info.standalone) {
      return {
        kind: 'install',
        title: 'Add Flick to your Home Screen',
        text: 'On iPhone and iPad, calls can only reach you when Flick is closed if it is installed: tap Share, then Add to Home Screen, and open Flick from there (iOS 16.4 or later).',
      };
    }
    return {
      kind: 'unsupported',
      title: "This browser can't receive call notifications",
      text: 'Calls will only ring while Flick is open.',
    };
  }
  return {
    kind: 'ask',
    title: 'Get calls when Flick is closed',
    text: ASK_TEXT,
    button: 'Allow notifications',
  };
};

// The one-time prompt after a person's first call: asked once, remembered either way.
const PROMPT_KEY = 'flick.callNotifPromptDone';

export const promptAlreadyHandled = (): boolean => {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1';
  } catch {
    return false;
  }
};
export const markPromptHandled = (): void => {
  try {
    localStorage.setItem(PROMPT_KEY, '1');
  } catch {
    // Storage blocked: the prompt may show again next time, which is harmless.
  }
};
