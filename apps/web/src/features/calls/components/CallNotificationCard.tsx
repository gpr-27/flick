import { useCallback, useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  PUSH_MESSAGES,
  PushError,
  enablePush,
  fetchVapidKey,
  getPushState,
  type PushState,
} from '@/features/notifications/push';
import { currentPlatformInfo, describeCallPermission } from '../callPermission';

/**
 * Asks for notification permission in context: "so you receive calls when Flick is closed".
 * The browser prompt only appears after the person clicks the button, never on page load.
 * `onDone` runs once they have answered the question (allowed, or the browser said no).
 */
export const CallNotificationCard = ({
  onDone,
  className = '',
}: {
  onDone?: () => void;
  className?: string;
}) => {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  // undefined = still loading; null = the server has no VAPID key, so push is off.
  const [vapidKey, setVapidKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPushState().then((s) => {
      if (cancelled) return;
      setState(s);
      // Only when there is something to ask. Fetched now, not on click: the browser prompt must
      // follow the click immediately.
      if (s !== 'unsubscribed') return;
      fetchVapidKey().then(
        (key) => {
          if (!cancelled) setVapidKey(key);
        },
        () => {
          if (!cancelled) setVapidKey(null);
        },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const allow = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await enablePush(vapidKey ?? null);
      setState('subscribed');
      onDone?.();
    } catch (e) {
      const failure = e instanceof PushError ? e.failure : 'failed';
      if (failure === 'denied') {
        setState('denied');
        onDone?.();
      } else setError(PUSH_MESSAGES[failure]);
    } finally {
      setBusy(false);
    }
  }, [vapidKey, onDone]);

  const view = describeCallPermission(state, currentPlatformInfo());
  if (view.kind === 'loading') return null;
  // The server cannot send pushes at all: offering the button would only lead to an error.
  if (view.kind === 'ask' && vapidKey === null) return null;

  return (
    <section
      aria-labelledby="call-notif-title"
      className={`rounded-2xl border border-base-content/10 bg-base-100/60 p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          {view.kind !== 'enabled' && (
            <h2 id="call-notif-title" className="font-semibold">
              {view.title}
            </h2>
          )}
          <p className={view.kind === 'enabled' ? '' : 'mt-1 text-base-content/70'}>{view.text}</p>
          {view.kind === 'denied' && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-base-content/70">
              {view.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
          {view.kind === 'ask' && (
            <Button
              variant="gradient"
              className="mt-3 h-10 px-4"
              loading={busy}
              disabled={vapidKey === undefined || busy}
              onClick={() => void allow()}
            >
              {view.button}
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-error">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
