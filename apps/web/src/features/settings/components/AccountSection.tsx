import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ENDPOINTS, type DeviceItem } from '@chat/contracts';
import type { z } from 'zod';
import { Modal } from '@/components/ui';
import { notify } from '@/components/ui/notify';
import { signOutOfClerk } from '@/features/auth/authBridge';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { EmailAliasRow } from '@/features/platform/EmailAliasRow';
import { PasskeysCard } from '@/features/platform/PasskeysCard';
import { LoginAlertsRow, WeekStatsCard } from '@/features/platform/SecurityRows';
import { downloadMyData } from '../exportData';
import { ActionButton, Card } from './controls';

type Device = z.infer<typeof DeviceItem>;

const when = (iso: string): string => new Date(iso).toLocaleString();

/** The browsers signed in to this account; each other one can be signed out. */
export const DevicesList = () => {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.devices.list)
      .then(
        (r) => {
          if (!cancelled) setDevices(r.items);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load your devices."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async (device: Device): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.devices.revoke, { params: { device_id: device.id } });
      setDevices((list) => list?.filter((d) => d.id !== device.id) ?? null);
      notify.success(`Signed out ${device.name}.`);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't sign that device out."));
    }
  };

  const signOutOthers = async (): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.devices.revokeOthers);
      setDevices((list) => list?.filter((d) => d.current) ?? null);
      notify.success('Signed out of your other devices.');
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't sign out the other devices."));
    }
  };

  const others = devices?.filter((d) => !d.current) ?? [];
  return (
    <div className="py-1">
      <p className="font-semibold">Signed-in devices</p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {!devices && !error && <p className="text-sm text-base-content/60">Loading...</p>}
      <ul className="mt-2 space-y-2">
        {devices?.map((d) => (
          <li key={d.id} className="flex min-h-[44px] items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                {d.name}
                {d.current && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                    This device
                  </span>
                )}
              </span>
              <span className="block text-xs text-base-content/60">
                Last active {when(d.last_active_at)}
              </span>
            </span>
            {!d.current && (
              <ActionButton
                onClick={() => {
                  void signOut(d);
                }}
              >
                <span className="sr-only">Sign out {d.name}</span>
                <span aria-hidden="true">Sign out</span>
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="mt-3">
          <ActionButton onClick={() => void signOutOthers()}>
            Sign out of other devices
          </ActionButton>
        </div>
      )}
    </div>
  );
};

/** Delete the account after typing the username. */
const DeleteAccount = () => {
  const username = useSessionStore((s) => s.user?.username ?? '');
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = typed.trim().toLowerCase() === username.toLowerCase() && username !== '';

  const close = (): void => {
    setOpen(false);
    setTyped('');
  };

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await getApi().call(ENDPOINTS.users.deleteAccount, { body: { username: typed.trim() } });
      useSessionStore.getState().reset();
      await signOutOfClerk();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't delete the account."));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
      <span>
        <span className="block font-semibold text-error">Delete my account</span>
        <span className="block text-sm text-base-content/60">
          Wipes your profile and signs out every device. Your old messages stay in other people’s
          chats as “Deleted user”.
        </span>
      </span>
      <ActionButton
        tone="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete
      </ActionButton>
      <Modal
        open={open}
        onClose={busy ? undefined : close}
        labelledBy="delete-account-title"
        initialFocusRef={inputRef}
        className="glass-card mx-4 w-full max-w-sm space-y-3 rounded-3xl p-6 animate-scale-in"
      >
        <h2 id="delete-account-title" className="font-display text-lg font-bold">
          Delete your account?
        </h2>
        <p className="text-sm">This cannot be undone. To confirm, type your username.</p>
        <label className="block text-sm font-semibold">
          Type {username} to confirm
          <input
            ref={inputRef}
            className="input-soft mt-1 min-h-[44px] w-full"
            autoComplete="off"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost min-h-[44px] rounded-2xl"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-error min-h-[44px] rounded-2xl"
            disabled={!matches || busy}
            onClick={() => void confirm()}
          >
            Delete account
          </button>
        </div>
      </Modal>
    </div>
  );
};

export const AccountSection = () => {
  const user = useSessionStore((s) => s.user);
  const [exporting, setExporting] = useState(false);

  const exportData = async (): Promise<void> => {
    setExporting(true);
    try {
      await downloadMyData();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't download your data."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card title="Account">
      <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
        <span className="min-w-0">
          <span className="block font-semibold">{user?.display_name}</span>
          <span className="block truncate text-sm text-base-content/60">
            {user?.email ?? `@${user?.username ?? ''}`}
          </span>
        </span>
        <Link to="/profile" className="btn btn-outline btn-sm min-h-[44px] rounded-2xl">
          Edit profile
        </Link>
      </div>
      <DevicesList />
      <LoginAlertsRow />
      <PasskeysCard />
      <EmailAliasRow />
      <WeekStatsCard />
      <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
        <span>
          <span className="block font-semibold">Download my data</span>
          <span className="block text-sm text-base-content/60">
            Your profile, chats and messages as one JSON file.
          </span>
        </span>
        <ActionButton disabled={exporting} onClick={() => void exportData()}>
          {exporting ? 'Preparing...' : 'Download'}
        </ActionButton>
      </div>
      <DeleteAccount />
    </Card>
  );
};
