// Settings > Notifications: what push does on this device, the switch, a button that proves it
// works end to end, and what to try when it does not.
import { useCallback, useEffect, useState } from 'react';
import { ENDPOINTS, type PushStatus, type PushTestResult } from '@chat/contracts';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { openInstallGuide } from '@/pwa/install';
import { PushToggle } from './NotificationSettings';
import { DEVICE_REASONS, detectDeviceState, unblockSteps, type DeviceState } from './pushDevice';
import { refreshPushSubscription } from './pushSync';

const RESULT_TEXT: Record<PushTestResult['devices'][number]['result'], string> = {
  sent: 'accepted',
  expired: 'expired (that device is switched off now; open Flick there to turn it on again)',
  failed: 'failed',
};

/** One line per device the test went to. */
const describeDevice = (d: PushTestResult['devices'][number], i: number): string =>
  `${d.this_device ? 'This device' : `Device ${i + 1}`} (${d.service}): ${RESULT_TEXT[d.result]}${
    d.status ? `, status ${d.status}` : ', no answer'
  }`;

export const PushPanel = () => {
  const [device, setDevice] = useState<DeviceState | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<PushTestResult | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setDevice(await detectDeviceState());
    try {
      setStatus(await getApi().call(ENDPOINTS.push.status));
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void detectDeviceState().then((d) => {
      if (!cancelled) setDevice(d);
    });
    getApi()
      .call(ENDPOINTS.push.status)
      .then(
        (s) => {
          if (!cancelled) setStatus(s);
        },
        () => undefined,
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const test = async (): Promise<void> => {
    setTesting(true);
    setError('');
    setResult(null);
    try {
      // Make sure the server has this device's current subscription before pushing to it.
      await refreshPushSubscription();
      setResult(await getApi().call(ENDPOINTS.push.test));
      void load();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't send the test notification."));
    } finally {
      setTesting(false);
    }
  };

  const on = device === 'on';
  return (
    <div className="space-y-3 pb-2">
      <div className="space-y-1 text-sm" data-testid="push-status">
        <p>
          <span className="font-semibold">This device: </span>
          {device === null ? 'Checking…' : on ? 'On' : 'Off'}
        </p>
        {device && <p className="text-base-content/60">{DEVICE_REASONS[device]}</p>}
        <p>
          <span className="font-semibold">Other devices: </span>
          {status ? status.other_devices : '–'}
        </p>
        {status && !status.server_ready && (
          <p className="text-error">Push notifications are not set up on the server.</p>
        )}
      </div>

      <PushToggle />

      {device === 'ios_install' && (
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-[44px]"
          onClick={openInstallGuide}
        >
          Show me how to add Flick to my Home Screen
        </button>
      )}
      {device === 'denied' && (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {unblockSteps().map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}

      <button
        type="button"
        className="btn btn-outline btn-sm min-h-[44px]"
        disabled={testing}
        onClick={() => void test()}
      >
        {testing ? 'Sending…' : 'Send me a test notification'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="space-y-1 text-sm" data-testid="push-test-result">
          {result.reason === 'not_configured' && (
            <p>Push is not set up on the server, so nothing could be sent.</p>
          )}
          {result.reason === 'no_subscription' && (
            <p>
              The server has no subscription for you yet. Turn the switch on above and try again.
            </p>
          )}
          {result.devices.map((d, i) => (
            <p key={`${d.service}-${i}`}>{describeDevice(d, i)}</p>
          ))}
          {result.devices.some((d) => d.result === 'sent') && (
            <p className="text-base-content/70">
              If no notification appeared within a few seconds, see the tips below.
            </p>
          )}
        </div>
      )}

      <details className="text-sm text-base-content/70">
        <summary className="cursor-pointer font-semibold">Not getting notifications?</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Use the test button. "Accepted" means the push service took it.</li>
          <li>Allow notifications for Flick in your browser or phone settings.</li>
          <li>On iPhone/iPad, add Flick to your Home Screen and open it from there.</li>
          <li>Turn off battery saver or "Do not disturb", and do not force-quit the app.</li>
          <li>Muted chats stay silent, except for mentions and replies to you.</li>
          <li>Quiet hours mute message notifications on this device.</li>
        </ul>
      </details>
    </div>
  );
};
