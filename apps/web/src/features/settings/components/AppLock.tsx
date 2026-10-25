import { useRef, useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { Modal } from '@/components/ui';
import { pinMatches, useAppLock, useIsAppLocked } from '../screenLock';
import { useSettingsStore } from '../useSettingsStore';

/** Covers the app until the PIN is typed. Rendered once, for signed-in users. */
export const AppLock = () => {
  const locked = useIsAppLocked();
  const hash = useSettingsStore((s) => s.screenLockHash);
  const unlock = useAppLock((s) => s.unlock);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (await pinMatches(pin, hash)) {
      setPin('');
      setWrong(false);
      unlock();
    } else {
      setWrong(true);
      setPin('');
    }
  };

  return (
    <Modal
      open={locked}
      labelledBy="app-lock-title"
      initialFocusRef={inputRef}
      closeOnBackdrop={false}
      overlayClassName="!z-[100] !bg-base-200 !backdrop-blur-none"
      className="glass-card mx-4 w-full max-w-xs space-y-4 rounded-3xl p-6 text-center"
    >
      <Lock className="mx-auto size-8 text-primary" aria-hidden="true" />
      <h2 id="app-lock-title" className="font-display text-xl font-bold">
        Flick is locked
      </h2>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <label className="block text-left text-sm font-semibold">
          PIN
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className="input-soft mt-1 min-h-11 w-full text-center tracking-widest"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, ''));
            }}
          />
        </label>
        {wrong && (
          <p role="alert" className="text-sm text-error">
            That PIN is not right.
          </p>
        )}
        <button type="submit" className="btn btn-primary min-h-11 w-full rounded-2xl">
          Unlock
        </button>
      </form>
    </Modal>
  );
};
