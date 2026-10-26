import { useState, type FormEvent } from 'react';
import { notify } from '@/components/ui/notify';
import {
  LOCK_DELAYS,
  PIN_PATTERN,
  hashPin,
  pinMatches,
  readLockMinutes,
  saveLockMinutes,
  useAppLock,
} from '../screenLock';
import { useSetting } from '../useSettingsStore';
import { ActionButton, Card, SelectRow } from './controls';

type Mode = 'idle' | 'set' | 'remove';

/** Turn the app lock on (choose a PIN) or off (type the PIN). */
export const ScreenLockSettings = () => {
  const [hash, setHash] = useSetting('screenLockHash');
  const lockNow = useAppLock((s) => s.lockNow);
  const [mode, setMode] = useState<Mode>('idle');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(readLockMinutes);

  const close = (): void => {
    setMode('idle');
    setPin('');
    setAgain('');
    setError(null);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (mode === 'set') {
      if (!PIN_PATTERN.test(pin)) {
        setError('Use 4 to 8 digits.');
        return;
      }
      if (pin !== again) {
        setError('The two PINs are different.');
        return;
      }
      saveLockMinutes(minutes);
      setHash(await hashPin(pin));
      // Setting the PIN does not lock you out of this tab.
      useAppLock.getState().unlock();
      notify.success('App lock is on.');
      close();
    } else if (mode === 'remove') {
      if (!(await pinMatches(pin, hash))) {
        setError('That PIN is not right.');
        return;
      }
      setHash(null);
      notify.success('App lock is off.');
      close();
    }
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="block text-sm font-semibold">
      {label}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        className="input-soft mt-1 min-h-[44px] w-full"
        value={value}
        onChange={(e) => {
          set(e.target.value.replace(/\D/g, ''));
        }}
      />
    </label>
  );

  return (
    <Card title="App lock">
      <p className="text-sm text-base-content/60">
        Ask for a PIN when Flick is opened. It keeps casual snoopers out; it is not encryption.
      </p>
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2 pt-2">
          {hash === null ? (
            <ActionButton
              onClick={() => {
                setMode('set');
              }}
            >
              Set a PIN
            </ActionButton>
          ) : (
            <>
              <ActionButton onClick={lockNow}>Lock now</ActionButton>
              <ActionButton
                onClick={() => {
                  setMode('set');
                }}
              >
                Change PIN
              </ActionButton>
              <ActionButton
                tone="danger"
                onClick={() => {
                  setMode('remove');
                }}
              >
                Turn off
              </ActionButton>
            </>
          )}
        </div>
      )}
      {mode !== 'idle' && (
        <form onSubmit={(e) => void submit(e)} className="space-y-3 pt-2">
          {field(mode === 'set' ? 'New PIN (4 to 8 digits)' : 'Current PIN', pin, setPin)}
          {mode === 'set' && field('Type it again', again, setAgain)}
          {mode === 'set' && (
            <SelectRow
              label="Require PIN"
              value={String(minutes)}
              options={LOCK_DELAYS.map((m) => ({
                value: String(m),
                label:
                  m === 0
                    ? 'Only when Flick opens'
                    : m === 60
                      ? 'After 1 hour away'
                      : `After ${m} min away`,
              }))}
              onChange={(value) => {
                setMinutes(Number(value));
              }}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary min-h-[44px] rounded-2xl">
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost min-h-[44px] rounded-2xl"
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  );
};
