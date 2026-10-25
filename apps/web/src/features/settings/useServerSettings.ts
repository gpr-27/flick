// The settings kept on the server (privacy, who can add me to groups, the Flick language), as one
// hook: load once, change one value at a time, show the change at once and put the old value
// back if the server refuses.
import { useEffect, useState } from 'react';
import { ENDPOINTS, type AccountSettings } from '@chat/contracts';
import type { z } from 'zod';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

export type ServerSettings = z.infer<typeof AccountSettings>;

export function useServerSettings(): {
  settings: ServerSettings | null;
  error: string | null;
  /** Try loading again after an error. */
  retry: () => void;
  change: (patch: Partial<ServerSettings>) => Promise<boolean>;
} {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.settings)
      .then(
        (s) => {
          if (!cancelled) setSettings(s);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load your settings."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = (): void => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  const change = async (patch: Partial<ServerSettings>): Promise<boolean> => {
    if (!settings) return false;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    try {
      setSettings(await getApi().call(ENDPOINTS.users.updateSettings, { body: patch }));
      return true;
    } catch (e) {
      setSettings(previous);
      notify.error(getErrorMessage(e, "Couldn't save that change."));
      return false;
    }
  };

  return { settings, error, retry, change };
}
