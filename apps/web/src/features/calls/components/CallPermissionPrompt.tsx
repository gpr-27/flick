import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getPushState } from '@/features/notifications/push';
import { markPromptHandled, promptAlreadyHandled } from '../callPermission';
import { useCallStore } from '../useCallStore';
import { CallNotificationCard } from './CallNotificationCard';

/**
 * The first time a person places or receives a call, and it is over, offer to get calls when
 * Flick is closed. It waits for the call to end so it never covers the call screen, shows the
 * card once (the button is the click that lets the browser ask), and remembers the answer.
 */
export const CallPermissionPrompt = () => {
  const inCall = useCallStore((s) => s.callStatus !== 'idle');
  const hadCall = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (inCall) {
      hadCall.current = true;
      return;
    }
    if (!hadCall.current || promptAlreadyHandled()) return;
    let cancelled = false;
    // Only worth asking when the answer is still open: not yet allowed, not blocked.
    void getPushState().then((state) => {
      if (cancelled) return;
      if (state === 'unsubscribed' || state === 'unsupported') setOpen(true);
      else markPromptHandled();
    });
    return () => {
      cancelled = true;
    };
  }, [inCall]);

  if (!open) return null;
  const close = (): void => {
    markPromptHandled();
    setOpen(false);
  };
  return (
    <div className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-md rounded-3xl shadow-xl">
      <CallNotificationCard onDone={close} className="pr-12" />
      <button
        type="button"
        aria-label="Not now"
        onClick={close}
        className="btn btn-circle btn-ghost btn-sm absolute right-3 top-3"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
};
