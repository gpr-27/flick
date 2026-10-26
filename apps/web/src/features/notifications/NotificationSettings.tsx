import { useEffect, useState } from 'react';
import { DigestSetting } from './DigestSetting';
import { notify } from '@/components/ui/notify';
import {
  PUSH_MESSAGES,
  PushError,
  disablePush,
  enablePush,
  fetchVapidKey,
  getPushState,
  type PushFailure,
  type PushState,
} from './push';

/** The push on/off row (Settings > Notifications). The other notification choices are in settings. */
export const PushToggle = () => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  // undefined = still loading; null = the server has no VAPID key.
  const [vapidKey, setVapidKey] = useState<string | null | undefined>(undefined);
  const [keyError, setKeyError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PushFailure | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    // Fetched now, not on click: the permission prompt must follow the click immediately.
    fetchVapidKey().then(
      (key) => {
        if (!cancelled) setVapidKey(key);
      },
      () => {
        if (!cancelled) setKeyError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      if (state === 'subscribed') {
        await disablePush();
        setState('unsubscribed');
        notify.success('Push notifications are off.');
      } else {
        await enablePush(vapidKey ?? null);
        setState('subscribed');
        notify.success('Push notifications are on.');
      }
    } catch (error) {
      const why = error instanceof PushError ? error.failure : 'failed';
      setFailure(why);
      if (why === 'denied') setState('denied');
    } finally {
      setBusy(false);
    }
  };

  const unavailable: PushFailure | null =
    state === 'unsupported'
      ? 'unsupported'
      : state === 'denied'
        ? 'denied'
        : vapidKey === null
          ? 'no_vapid_key'
          : keyError
            ? 'failed'
            : null;
  const message = failure ?? unavailable;
  const ready = state !== 'loading' && vapidKey !== undefined;

  return (
    <div>
      <label className="flex min-h-[44px] items-center justify-between gap-4">
        <span>
          <span className="block font-semibold">Push notifications</span>
          <span className="block text-sm text-base-content/60">
            Get new messages even when Flick is closed.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          role="switch"
          aria-label="Push notifications"
          checked={state === 'subscribed'}
          disabled={
            busy || (!ready && !unavailable) || (unavailable !== null && state !== 'subscribed')
          }
          onChange={() => void toggle()}
        />
      </label>
      <DigestSetting />
      {message && (
        <p role="alert" className="mt-2 text-sm text-error">
          {PUSH_MESSAGES[message]}
        </p>
      )}
    </div>
  );
};
