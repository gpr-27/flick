// The app is open and the call is now on screen, so the "is calling" notification (which the
// service worker showed while the app was closed) is taken down.
import { callTag } from '@/pwa/callPush';

export const closeCallNotification = async (callId: string): Promise<void> => {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const shown = (await registration?.getNotifications({ tag: callTag(callId) })) ?? [];
    for (const notification of shown) notification.close();
  } catch {
    // No service worker or no permission: there is nothing to close.
  }
};
