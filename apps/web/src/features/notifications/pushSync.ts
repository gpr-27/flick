// Keeps this device's push subscription alive. Run at every app start while signed in:
//   permission granted + no browser subscription  -> subscribe again
//   the server does not know our CURRENT endpoint -> tell it (an upsert; never a second row)
// Most "I get no notifications" cases were a subscription that was lost, replaced by the push
// service, or never sent to the server, and nothing ever repaired it.
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import {
  fetchVapidKey,
  pushSupported,
  pushTurnedOffByUser,
  registerSubscription,
  swRegistration,
  urlBase64ToBytes,
} from './push';

export type RefreshResult =
  | 'unsupported'
  | 'turned_off'
  | 'no_permission'
  | 'server_not_ready'
  | 'in_sync'
  | 'registered'
  | 'error';

/** The same short fingerprint the server computes: first 16 hex characters of SHA-256. */
export const endpointHash = async (endpoint: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
};

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (!a) return true; // unknown: assume it matches
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

let inflight: Promise<RefreshResult> | null = null;

/** Single-flight: calls made while one is running share its answer. */
export const refreshPushSubscription = (): Promise<RefreshResult> => {
  inflight ??= run().finally(() => {
    inflight = null;
  });
  return inflight;
};

async function run(): Promise<RefreshResult> {
  if (!pushSupported()) return 'unsupported';
  if (pushTurnedOffByUser()) return 'turned_off';
  if (Notification.permission !== 'granted') return 'no_permission';
  try {
    const status = await getApi().call(ENDPOINTS.push.status);
    if (!status.server_ready) return 'server_not_ready';
    const registration = await swRegistration();
    let subscription = await registration.pushManager.getSubscription();

    // The server's key may have changed since this subscription was made: it cannot be used.
    const key = await fetchVapidKey();
    if (!key) return 'server_not_ready';
    const keyBytes = urlBase64ToBytes(key);
    // (options can be missing in older browsers, although the type says otherwise)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (subscription && !sameKey(subscription.options?.applicationServerKey, keyBytes)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });

    const known =
      status.this_device.subscribed &&
      status.this_device.endpoint_hash === (await endpointHash(subscription.endpoint));
    if (known) return 'in_sync';
    await registerSubscription(subscription);
    return 'registered';
  } catch {
    return 'error';
  }
}

/** The person changed previews or quiet hours: send the new choices (a no-op without a subscription). */
export async function syncPushPrefs(): Promise<void> {
  if (!pushSupported() || pushTurnedOffByUser() || Notification.permission !== 'granted') return;
  try {
    const subscription = await (await swRegistration()).pushManager.getSubscription();
    if (subscription) await registerSubscription(subscription);
  } catch {
    // retried at the next app start
  }
}

/**
 * Signed out: stop pushes on this browser. The sign-out has already taken the login away, so the
 * server cannot be told; it disables the row itself when the push service answers 404/410, and
 * the next person to sign in here replaces it.
 */
export async function dropLocalSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const subscription = await (await swRegistration(2_000)).pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // nothing to drop
  }
}
