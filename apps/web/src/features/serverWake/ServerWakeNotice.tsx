import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui';
import { useServerWake } from './useServerWake';

/** The page was hidden at least this long: the server may have gone to sleep meanwhile. */
const RECHECK_AFTER_HIDDEN_MS = 5 * 60_000;
/** The promise of "about 30 seconds" is dropped after this long, so the message stays honest. */
const LONGER_AFTER_S = 45;

/**
 * "The server is waking up." Shown only while the server is slow to answer, and it goes away by
 * itself the moment the server is up, so nobody is left looking at a broken page.
 */
export const ServerWakeNotice = () => {
  const waking = useServerWake((s) => s.waking);
  const since = useServerWake((s) => s.since);
  const check = useServerWake((s) => s.check);
  const stop = useServerWake((s) => s.stop);
  const [now, setNow] = useState(() => Date.now());

  // Ask as soon as the page opens, when the connection returns, and when the person comes back to
  // a tab that was in the background for a while.
  useEffect(() => {
    check();
    let hiddenAt = 0;
    const onVisible = (): void => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > RECHECK_AFTER_HIDDEN_MS) check();
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [check, stop]);

  useEffect(() => {
    if (!waking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [waking]);

  if (!waking) return null;
  const seconds = Math.max(0, Math.round((now - (since ?? now)) / 1000));

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="server-wake"
      className="glass-card pointer-events-none fixed inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-[66] mx-auto flex max-w-md items-start gap-3 rounded-2xl p-4 shadow-lg"
    >
      <Spinner size="sm" label="Waiting for the server" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">The server is waking up</p>
        <p className="mt-0.5 text-base-content/70">
          {seconds < LONGER_AFTER_S
            ? 'Flick runs on a free server that sleeps when nobody is using it. Please wait about 30 seconds: this page carries on by itself.'
            : 'Still starting up. Thanks for waiting: this page carries on by itself as soon as the server is ready.'}
        </p>
        <p className="mt-1 text-xs tabular-nums text-base-content/60">Waiting {seconds} s…</p>
      </div>
    </div>
  );
};
