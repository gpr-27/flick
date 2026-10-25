import { useEffect, useRef } from 'react';
import { PUSH_CHANGED_EVENT } from '@/pwa/openFromNotification';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { dropLocalSubscription, refreshPushSubscription, syncPushPrefs } from './pushSync';

/** Re-check when the app comes back to the front, but not more often than this. */
const RECHECK_MS = 10 * 60_000;

/**
 * Keeps push working without the person doing anything:
 *   - at app start (once signed in) and when the app returns to the front: repair the subscription;
 *   - when the browser replaced the subscription (the service worker says so): repair it;
 *   - when previews or quiet hours change: tell the server;
 *   - after sign-out: drop this browser's subscription.
 */
export function usePushLifecycle(signedIn: boolean, ready: boolean): void {
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (wasSignedIn.current && !signedIn) void dropLocalSubscription();
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  useEffect(() => {
    if (!ready) return;
    let last = Date.now();
    void refreshPushSubscription();
    const recheck = (): void => {
      last = Date.now();
      void refreshPushSubscription();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - last > RECHECK_MS) recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(PUSH_CHANGED_EVENT, recheck);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopSettings = useSettingsStore.subscribe((now, before) => {
      if (
        now.messagePreviews === before.messagePreviews &&
        now.quietHoursOn === before.quietHoursOn &&
        now.quietFrom === before.quietFrom &&
        now.quietTo === before.quietTo
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => void syncPushPrefs(), 1_000);
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(PUSH_CHANGED_EVENT, recheck);
      stopSettings();
      clearTimeout(timer);
    };
  }, [ready]);
}
