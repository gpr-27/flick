// What notifications look like on THIS device, as one plain answer the prompt, the banner and the
// settings panel all share.
import { isIos, isStandalone } from '@/pwa/install';
import { getPushState, pushSupported, pushTurnedOffByUser } from './push';

export type DeviceState =
  | 'on' // pushes will arrive
  | 'can_ask' // permission not asked yet: a tap can turn it on
  | 'off' // allowed in the browser, but push is switched off here
  | 'denied' // blocked in the browser or phone settings
  | 'ios_install' // iPhone/iPad browser tab: push only works from the Home Screen app
  | 'unsupported';

/** Why, in words (shown next to "This device: Off"). */
export const DEVICE_REASONS: Record<DeviceState, string> = {
  on: 'You will get a notification when a message arrives and Flick is closed.',
  can_ask: 'Not turned on yet. Tap Turn on and choose Allow.',
  off: 'You switched push off on this device.',
  denied: 'Notifications are blocked for Flick in your browser or phone settings.',
  ios_install:
    'On iPhone and iPad, notifications only work in the Home Screen app. Add Flick to your Home Screen first, then open it from there and turn on notifications.',
  unsupported: "This browser can't receive push notifications.",
};

export const detectDeviceState = async (): Promise<DeviceState> => {
  if (isIos() && !isStandalone()) return 'ios_install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'can_ask';
  if (pushTurnedOffByUser()) return 'off';
  return (await getPushState()) === 'subscribed' ? 'on' : 'off';
};

/** How to unblock notifications, for this kind of device. */
export const unblockSteps = (ua = navigator.userAgent): string[] => {
  if (/iPhone|iPad|iPod/.test(ua))
    return [
      'Open the Settings app.',
      'Scroll down to Flick (or Notifications > Flick).',
      'Turn on Allow Notifications.',
    ];
  if (/Android/i.test(ua))
    return [
      'Tap the lock icon next to the address (or long-press the Flick icon > App info).',
      'Open Permissions (or Notifications).',
      'Set Notifications to Allow, then reopen Flick.',
    ];
  return [
    'Click the lock (or tune) icon left of the address bar.',
    'Open "Site settings" or "Permissions".',
    'Set Notifications to "Allow", then reload Flick.',
  ];
};
