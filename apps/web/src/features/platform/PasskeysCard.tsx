// Passkeys in Settings > Account, using Clerk's passkey API on the signed-in user
// (user.createPasskey, passkey.update, passkey.delete). Needs Passkeys switched on in the Clerk
// dashboard (User & authentication > Passkeys); with it off the whole section stays hidden.
import { useState } from 'react';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { ActionButton } from '@/features/settings/components/controls';
import { getClerk, passkeysAvailable } from './passkeys';

export const PasskeysCard = () => {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const clerk = getClerk();
  if (!passkeysAvailable(clerk) || !clerk?.user) return null;
  const user = clerk.user;
  const passkeys = user.passkeys ?? [];
  const refresh = async (): Promise<void> => {
    await user.reload?.();
    setTick((n) => n + 1);
  };

  const run = async (fn: () => Promise<unknown>, failure: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify.error(getErrorMessage(e, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-1" role="group" aria-labelledby="passkeys-title">
      <div className="flex min-h-[44px] items-center justify-between gap-4">
        <span>
          <span id="passkeys-title" className="block font-semibold">
            Passkeys
          </span>
          <span className="block text-sm text-base-content/60">
            Sign in with your fingerprint, face or screen lock instead of a code.
          </span>
        </span>
        <ActionButton
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await user.createPasskey?.();
            }, "Couldn't add a passkey.")
          }
        >
          Add a passkey
        </ActionButton>
      </div>
      <ul className="mt-1 space-y-1">
        {passkeys.map((p) => (
          <li key={p.id} className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-semibold">{p.name ?? 'Passkey'}</span>
            <span className="flex gap-2">
              <ActionButton
                disabled={busy}
                onClick={() => {
                  const name = window.prompt('Name this passkey', p.name ?? '')?.trim();
                  if (name) void run(() => p.update({ name }), "Couldn't rename the passkey.");
                }}
              >
                <span className="sr-only">Rename {p.name ?? 'passkey'}</span>
                <span aria-hidden="true">Rename</span>
              </ActionButton>
              <ActionButton
                tone="danger"
                disabled={busy}
                onClick={() => void run(() => p.delete(), "Couldn't remove the passkey.")}
              >
                <span className="sr-only">Remove {p.name ?? 'passkey'}</span>
                <span aria-hidden="true">Remove</span>
              </ActionButton>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
