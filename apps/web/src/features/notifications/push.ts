// Web Push in the browser: ask permission (after a click), subscribe with the server's VAPID
// key, and tell the API about the subscription. The worker later sends pushes to it.
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

export type PushFailure = 'unsupported' | 'denied' | 'no_vapid_key' | 'failed';

export class PushError extends Error {
  readonly failure: PushFailure;
  constructor(failure: PushFailure, message: string) {
    super(message);
    this.name = 'PushError';
    this.failure = failure;
  }
}

/** Plain-language text for each failure, shown under the toggle. */
export const PUSH_MESSAGES: Record<PushFailure, string> = {
  unsupported: "This browser can't receive push notifications.",
  denied: 'Notifications are blocked. Allow them in your browser settings, then try again.',
  no_vapid_key: "Push notifications aren't set up on this server yet.",
  failed: 'Something went wrong turning notifications on. Please try again.',
};

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

/** The key arrives base64url-encoded; pushManager.subscribe wants bytes. */
export const urlBase64ToBytes = (base64Url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

/** The server's public VAPID key, or null when the server has none (push is off). */
export const fetchVapidKey = async (): Promise<string | null> =>
  (await getApi().call(ENDPOINTS.push.vapidKey)).public_key;

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

export const getPushState = async (): Promise<PushState> => {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === 'granted' ? 'subscribed' : 'unsubscribed';
};

/**
 * Call from a click handler (browsers only show the permission prompt after a user gesture).
 * The key is passed in, already fetched, so no network wait comes between the click and the prompt.
 */
export const enablePush = async (vapidKey: string | null): Promise<void> => {
  if (!pushSupported()) throw new PushError('unsupported', PUSH_MESSAGES.unsupported);
  if (!vapidKey) throw new PushError('no_vapid_key', PUSH_MESSAGES.no_vapid_key);

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError('denied', PUSH_MESSAGES.denied);

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(vapidKey),
      }));
    const { endpoint, keys } = subscription.toJSON();
    await getApi().call(ENDPOINTS.push.subscribe, {
      body: {
        endpoint: endpoint ?? subscription.endpoint,
        keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
      },
    });
  } catch {
    throw new PushError('failed', PUSH_MESSAGES.failed);
  }
};

export const disablePush = async (): Promise<void> => {
  if (!pushSupported()) throw new PushError('unsupported', PUSH_MESSAGES.unsupported);
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    try {
      await getApi().call(ENDPOINTS.push.unsubscribe, {
        body: { endpoint: subscription.endpoint },
      });
    } finally {
      // Even if the server call failed, stop receiving here; the server drops dead endpoints itself.
      await subscription.unsubscribe();
    }
  } catch {
    throw new PushError('failed', PUSH_MESSAGES.failed);
  }
};
