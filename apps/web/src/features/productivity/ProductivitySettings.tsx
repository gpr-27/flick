import { useEffect, useState } from 'react';
import { ENDPOINTS, type ProductivitySettings as Settings } from '@chat/contracts';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { setQuietSettings } from './quiet';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Settings > Notifications: the briefing (off / daily / weekly) and server-side quiet hours. */
export const ProductivitySettings = () => {
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    getApi()
      .call(ENDPOINTS.productivity.getSettings)
      .then(setS, () => undefined);
  }, []);
  if (!s) return null;

  const save = async (next: Settings): Promise<void> => {
    setS(next);
    try {
      const saved = await getApi().call(ENDPOINTS.productivity.putSettings, { body: next });
      setS(saved);
      setQuietSettings(saved);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't save the setting."));
    }
  };

  return (
    <section
      className="glass-card flex flex-col gap-3 rounded-2xl p-4 text-sm"
      aria-label="Briefing and quiet hours"
    >
      <h3 className="font-semibold">Briefing</h3>
      <label className="flex items-center justify-between gap-2">
        Briefing from Flick at 8 am
        <select
          className="select select-bordered select-sm"
          value={s.digest}
          onChange={(e) =>
            void save({
              ...s,
              digest: e.target.value as Settings['digest'],
              quiet_timezone:
                s.quiet_timezone === 'UTC'
                  ? Intl.DateTimeFormat().resolvedOptions().timeZone
                  : s.quiet_timezone,
            })
          }
        >
          <option value="off">Off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <h3 className="font-semibold">Quiet hours (push and sounds)</h3>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={s.quiet_enabled}
          onChange={(e) => void save({ ...s, quiet_enabled: e.target.checked })}
        />
        Silence notifications during these hours
      </label>
      {s.quiet_enabled && (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              From
              <input
                type="time"
                className="input input-bordered input-sm"
                value={s.quiet_start}
                onChange={(e) => e.target.value && void save({ ...s, quiet_start: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              To
              <input
                type="time"
                className="input input-bordered input-sm"
                value={s.quiet_end}
                onChange={(e) => e.target.value && void save({ ...s, quiet_end: e.target.value })}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={s.quiet_days.includes(i)}
                className={`btn btn-xs ${s.quiet_days.includes(i) ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() =>
                  void save({
                    ...s,
                    quiet_days: s.quiet_days.includes(i)
                      ? s.quiet_days.filter((x) => x !== i)
                      : [...s.quiet_days, i],
                  })
                }
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-base-content/60">
            Time zone: {s.quiet_timezone}.{' '}
            <button
              type="button"
              className="underline"
              onClick={() =>
                void save({
                  ...s,
                  quiet_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })
              }
            >
              Use this device&apos;s time zone
            </button>
          </p>
        </>
      )}
    </section>
  );
};
