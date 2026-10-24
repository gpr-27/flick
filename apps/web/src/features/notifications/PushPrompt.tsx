// Asks about push notifications in context: only once the user has chats, only after a tap,
// and never again once dismissed. If the browser has blocked them, says how to unblock.
import { useEffect, useState } from 'react';
import {
  enablePush,
  fetchVapidKey,
  getPushState,
  PUSH_MESSAGES,
  PushError,
  pushSupported,
} from './push';

const DISMISSED_KEY = 'flick-push-prompt-dismissed';

const wasDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

type View = 'hidden' | 'ask' | 'blocked';

export const PushPrompt = () => {
  const [view, setView] = useState<View>('hidden');
  // Fetched up front so the permission prompt follows the tap with no network wait.
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported() || wasDismissed()) return;
    let cancelled = false;
    void getPushState().then((state) => {
      if (cancelled) return;
      if (state === 'unsubscribed' && Notification.permission === 'default') setView('ask');
      else if (state === 'denied') setView('blocked');
    });
    fetchVapidKey().then(
      (key) => {
        if (!cancelled) setVapidKey(key);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = (): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // not remembered; it may show again next time
    }
    setView('hidden');
  };

  const turnOn = async (): Promise<void> => {
    try {
      await enablePush(vapidKey);
      setView('hidden');
    } catch (error) {
      setView(error instanceof PushError && error.failure === 'denied' ? 'blocked' : 'hidden');
    }
  };

  if (view === 'hidden' || (view === 'ask' && !vapidKey)) return null;
  return (
    <div
      className="mx-3 mt-2 rounded-2xl bg-primary/10 p-3 text-sm"
      role="region"
      aria-label="Notifications"
    >
      {view === 'ask' ? (
        <>
          <p className="font-semibold">Get new messages even when Flick is closed</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary btn-xs" onClick={() => void turnOn()}>
              Turn on notifications
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={dismiss}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="font-semibold">Notifications blocked</p>
          <p className="text-base-content/70">{PUSH_MESSAGES.denied}</p>
          <button type="button" className="btn btn-ghost btn-xs mt-1" onClick={dismiss}>
            Got it
          </button>
        </>
      )}
    </div>
  );
};
