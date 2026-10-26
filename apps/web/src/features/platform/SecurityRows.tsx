// Settings rows for the platform features: the "new device" sign-in alert, and "Your week in Flick".
import { useEffect, useState } from 'react';
import { ENDPOINTS, type WeekStats } from '@chat/contracts';
import type { z } from 'zod';
import { ToggleRow } from '@/features/settings/components/controls';
import { getApi } from '@/lib/services';

export const LoginAlertsRow = () => {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => getApi().call(ENDPOINTS.platform.loginAlerts))
      .then(
        (r: { enabled?: boolean } | undefined) => {
          if (typeof r?.enabled === 'boolean') setEnabled(r.enabled);
        },
        () => undefined,
      );
  }, []);
  if (enabled === null) return null;
  return (
    <ToggleRow
      label="Alert me about new sign-ins"
      hint="Flick posts a note in Saved messages when your account is signed in from a new device."
      checked={enabled}
      onChange={(next) => {
        setEnabled(next);
        void getApi()
          .call(ENDPOINTS.platform.setLoginAlerts, { body: { enabled: next } })
          .catch(() => {
            setEnabled(!next);
          });
      }}
    />
  );
};

export const WeekStatsCard = () => {
  const [stats, setStats] = useState<z.infer<typeof WeekStats> | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => getApi().call(ENDPOINTS.platform.weekStats))
      .then(
        (r: z.infer<typeof WeekStats> | undefined) => {
          if (Array.isArray(r?.busiest_chats)) setStats(r);
        },
        () => undefined,
      );
  }, []);
  if (!stats) return null;
  return (
    <section aria-label="Your week in Flick" className="glass-card rounded-3xl p-4">
      <h3 className="font-display font-bold">Your week in Flick</h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-center">
        <div>
          <dd className="text-2xl font-bold">{stats.messages_sent}</dd>
          <dt className="text-xs text-base-content/60">messages sent</dt>
        </div>
        <div>
          <dd className="text-2xl font-bold">{stats.voice_minutes}</dd>
          <dt className="text-xs text-base-content/60">voice minutes</dt>
        </div>
      </dl>
      {stats.busiest_chats.length > 0 && (
        <>
          <p className="mt-3 text-sm font-semibold">Busiest chats</p>
          <ol className="text-sm text-base-content/70">
            {stats.busiest_chats.map((c) => (
              <li key={c.conversation_id} className="flex justify-between gap-2">
                <span className="truncate">{c.name}</span>
                <span>{c.messages}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
};
