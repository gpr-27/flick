// Asks about push notifications in context, and keeps saying so while they are off.
//   - A friendly card ("Turn on notifications so you never miss a message") once the person has a
//     conversation with a message in it, never on page load. "Not now" hides it for a few days.
//   - A small banner in the chat list for as long as notifications are off on this device.
// iPhone/iPad browser tabs and blocked permissions get steps instead of a button that cannot work.
import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { openInstallGuide } from '@/pwa/install';
import { DEVICE_REASONS, detectDeviceState, unblockSteps, type DeviceState } from './pushDevice';
import { enablePush, fetchVapidKey, PushError } from './push';
import { refreshPushSubscription } from './pushSync';

const SNOOZE_KEY = 'flick-push-card-snoozed-until';
const SNOOZE_MS = 3 * 24 * 3_600_000;

const snoozed = (): boolean => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
};

/** Someone has sent or received a message: the moment turning notifications on makes sense. */
const useHasMessages = (): boolean =>
  useChatStore((s) => Object.values(s.conversations).some((c) => c.last_message !== null));

export const PushPrompt = () => {
  const [state, setState] = useState<DeviceState | null>(null);
  const [hidden, setHidden] = useState(snoozed);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [steps, setSteps] = useState(false);
  const hasMessages = useHasMessages();

  useEffect(() => {
    let cancelled = false;
    void detectDeviceState().then((s) => {
      if (cancelled) return;
      if (s === 'on') markUsed('push.permission');
      setState(s);
    });
    // Fetched now, not on the tap: the permission prompt must follow the tap at once.
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

  const canTurnOn = (state === 'can_ask' || state === 'off') && vapidKey !== null;
  const showCard = canTurnOn && hasMessages && !hidden;
  useFeatureGuide('push.permission', showCard);
  if (state === null || state === 'on' || state === 'unsupported') return null;

  const turnOn = async (): Promise<void> => {
    try {
      await enablePush(vapidKey);
      void refreshPushSubscription();
      markUsed('push.permission');
      setState('on');
    } catch (error) {
      setState(error instanceof PushError && error.failure === 'denied' ? 'denied' : state);
    }
  };

  const snooze = (): void => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // not remembered; the card may show again next time
    }
    setHidden(true);
  };

  if (showCard) {
    return (
      <div
        data-guide="push.prompt"
        className="mx-3 mt-2 rounded-2xl bg-primary/10 p-3 text-sm"
        role="region"
        aria-label="Notifications"
      >
        <p className="font-semibold">Turn on notifications so you never miss a message</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn btn-primary btn-xs" onClick={() => void turnOn()}>
            Allow
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={snooze}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mx-3 mt-2 rounded-2xl bg-base-content/5 px-3 py-2 text-sm"
      role="region"
      aria-label="Notifications"
    >
      <div className="flex items-center gap-2">
        <BellOff className="size-4 shrink-0 text-base-content/60" aria-hidden="true" />
        <p className="min-w-0 flex-1">Notifications are off on this device</p>
        {canTurnOn && (
          <button type="button" className="btn btn-primary btn-xs" onClick={() => void turnOn()}>
            Turn on
          </button>
        )}
        {state === 'ios_install' && (
          <button type="button" className="btn btn-primary btn-xs" onClick={openInstallGuide}>
            How
          </button>
        )}
        {state === 'denied' && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setSteps((v) => !v);
            }}
          >
            {steps ? 'Hide' : 'How to fix'}
          </button>
        )}
      </div>
      {(state === 'ios_install' || (state === 'denied' && steps)) && (
        <div className="mt-1 text-base-content/70">
          <p>{DEVICE_REASONS[state]}</p>
          {state === 'denied' && (
            <ol className="mt-1 list-decimal pl-5">
              {unblockSteps().map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};
