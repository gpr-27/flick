import { useEffect, useState } from 'react';
import { ENDPOINTS, type PrivacySettings as PrivacySchema } from '@chat/contracts';
import type { z } from 'zod';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

type Privacy = z.infer<typeof PrivacySchema>;
type Audience = Privacy['last_seen'];

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'nobody', label: 'Nobody' },
];

const AUDIENCE_FIELDS = [
  { key: 'last_seen', label: 'Last seen and online' },
  { key: 'profile_photo', label: 'Profile photo' },
  { key: 'about', label: 'About' },
] as const;

export const PrivacySettings = () => {
  const [settings, setSettings] = useState<Privacy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.users.privacy)
      .then(
        (s) => {
          if (!cancelled) setSettings(s);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load your privacy settings."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  /** Save one change; show it at once and put the old value back if the server refuses. */
  const change = async (patch: Partial<Privacy>): Promise<void> => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    try {
      setSettings(await getApi().call(ENDPOINTS.users.updatePrivacy, { body: patch }));
    } catch (e) {
      setSettings(previous);
      notify.error(getErrorMessage(e, "Couldn't save that change."));
    }
  };

  return (
    <section className="glass-card rounded-3xl p-6" aria-labelledby="privacy-title">
      <h2 id="privacy-title" className="font-display text-lg font-bold">
        Privacy
      </h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      )}
      {!settings && !error && <p className="mt-3 text-sm text-base-content/60">Loading...</p>}
      {settings && (
        <div className="mt-4 space-y-4">
          {AUDIENCE_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-4">
              <span className="font-semibold">{label}</span>
              <select
                className="select select-bordered select-sm"
                aria-label={label}
                value={settings[key]}
                onChange={(e) => void change({ [key]: e.target.value as Audience })}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block font-semibold">Read receipts</span>
              <span className="block text-sm text-base-content/60">
                If off, you will not send or see read receipts.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              role="switch"
              aria-label="Read receipts"
              checked={settings.read_receipts}
              onChange={(e) => void change({ read_receipts: e.target.checked })}
            />
          </label>
        </div>
      )}
    </section>
  );
};
