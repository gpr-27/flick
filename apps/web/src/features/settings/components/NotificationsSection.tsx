import { useRef, useState } from 'react';
import { Modal } from '@/components/ui';
import { PushToggle } from '@/features/notifications/NotificationSettings';
import { playTestSound } from '@/features/notifications/sound';
import { useSetting } from '../useSettingsStore';
import { ActionButton, Card, SliderRow, ToggleRow } from './controls';

const PERMISSION_TEXT: Record<string, string> = {
  granted: 'Allowed',
  denied: 'Blocked in your browser',
  default: 'Not asked yet',
  unsupported: 'Not supported by this browser',
};

/** What the browser says about showing notifications. */
const permissionStatus = (): string =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission; // 'granted' | 'denied' | 'default'

const TimeField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => (
  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
    {label}
    <input
      type="time"
      className="input input-bordered input-sm min-h-11"
      value={value}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
    />
  </label>
);

export const NotificationsSection = () => {
  const [sound, setSound] = useSetting('messageSound');
  const [volume, setVolume] = useSetting('soundVolume');
  const [ringtone, setRingtone] = useSetting('ringtoneEnabled');
  const [vibration, setVibration] = useSetting('vibration');
  const [previews, setPreviews] = useSetting('messagePreviews');
  const [quiet, setQuiet] = useSetting('quietHoursOn');
  const [from, setFrom] = useSetting('quietFrom');
  const [to, setTo] = useSetting('quietTo');
  const [helpOpen, setHelpOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const status = permissionStatus();

  return (
    <Card title="Notifications">
      <PushToggle />
      <ToggleRow
        label="Message sound"
        hint="A short sound when a message arrives while this tab is in the background."
        checked={sound}
        onChange={setSound}
      />
      <SliderRow
        label="Volume"
        value={volume}
        onChange={setVolume}
        action={
          <ActionButton
            onClick={() => {
              playTestSound(volume);
            }}
          >
            Test
          </ActionButton>
        }
      />
      <ToggleRow
        label="Call ringtone"
        hint="Ring when someone calls you."
        checked={ringtone}
        onChange={setRingtone}
      />
      <ToggleRow
        label="Vibration"
        hint="Buzz for messages and calls on devices that can."
        checked={vibration}
        onChange={setVibration}
      />
      <ToggleRow
        label="Message previews"
        hint="Show the message text in desktop notifications. Off shows only “New message”."
        checked={previews}
        onChange={setPreviews}
      />
      <ToggleRow
        label="Quiet hours"
        hint="No message sounds or desktop notifications in this window. Calls still ring."
        checked={quiet}
        onChange={setQuiet}
      />
      {quiet && (
        <div className="flex flex-wrap gap-4 pb-2 pl-1">
          <TimeField label="From" value={from} onChange={setFrom} />
          <TimeField label="To" value={to} onChange={setTo} />
        </div>
      )}

      <div className="flex min-h-11 items-center justify-between gap-4 py-1">
        <p>
          <span className="block font-semibold">Browser permission</span>
          <span className="block text-sm text-base-content/60" data-testid="permission-status">
            {PERMISSION_TEXT[status] ?? status}
          </span>
        </p>
        <ActionButton
          onClick={() => {
            setHelpOpen(true);
          }}
        >
          How to change
        </ActionButton>
      </div>

      <Modal
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
        }}
        labelledBy="notif-help-title"
        initialFocusRef={closeRef}
        className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
      >
        <h2 id="notif-help-title" className="font-display text-lg font-bold">
          Allow notifications
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Click the lock (or tune) icon left of the address bar.</li>
          <li>Open “Site settings” or “Permissions”.</li>
          <li>Set Notifications to “Allow”.</li>
          <li>Reload Flick.</li>
        </ol>
        <p className="text-sm text-base-content/60">
          On iPhone, add Flick to your Home Screen first, then allow notifications in Settings.
        </p>
        <button
          ref={closeRef}
          type="button"
          className="btn btn-primary btn-sm min-h-11 w-full rounded-2xl"
          onClick={() => {
            setHelpOpen(false);
          }}
        >
          Got it
        </button>
      </Modal>
    </Card>
  );
};
