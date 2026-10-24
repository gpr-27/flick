import { useEffect, useState } from 'react';
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
import { useNotificationPrefs } from './useNotificationPrefs';

export const NotificationSettings = () => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  // undefined = still loading; null = the server has no VAPID key.
  const [vapidKey, setVapidKey] = useState<string | null | undefined>(undefined);
  const [keyError, setKeyError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PushFailure | null>(null);
  const sound = useNotificationPrefs((s) => s.sound);
  const setSound = useNotificationPrefs((s) => s.setSound);

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
    <section className="glass-card rounded-3xl p-6" aria-labelledby="notif-title">
      <h2 id="notif-title" className="font-display text-lg font-bold">
        Notifications
      </h2>

      <label className="mt-4 flex items-center justify-between gap-4">
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
      {message && (
        <p role="alert" className="mt-2 text-sm text-error">
          {PUSH_MESSAGES[message]}
        </p>
      )}

      <label className="mt-5 flex items-center justify-between gap-4">
        <span>
          <span className="block font-semibold">Message sound</span>
          <span className="block text-sm text-base-content/60">
            A short sound when a message arrives while this tab is in the background.
          </span>
        </span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          role="switch"
          aria-label="Message sound"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked);
          }}
        />
      </label>
    </section>
  );
};
