import { useEffect, useState } from 'react';
import { ENDPOINTS, type AiUsageResponse } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { featureLabel, usagePercent } from '@/features/ai/aiControls';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { saveBlob } from '../exportData';
import { ActionButton } from './controls';

/** Settings > Flick assistant: today's AI use, the speed setting and "my AI data". */
export const AiUsage = () => {
  const [usage, setUsage] = useState<AiUsageResponse | null>(null);
  const [speed, setSpeed] = useState<'fast' | 'quality'>('quality');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let live = true;
    const api = getApi();
    void Promise.resolve(api.call(ENDPOINTS.ai.usage))
      .then((u: AiUsageResponse | undefined) => live && u && setUsage(u))
      .catch(() => undefined);
    void Promise.resolve(api.call(ENDPOINTS.ai.preference))
      .then((p: { speed: 'fast' | 'quality' } | undefined) => live && p && setSpeed(p.speed))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const chooseSpeed = async (next: 'fast' | 'quality'): Promise<void> => {
    setSpeed(next);
    try {
      await getApi().call(ENDPOINTS.ai.setPreference, { body: { speed: next } });
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't save this."));
    }
  };

  const download = async (): Promise<void> => {
    try {
      const data = await getApi().call(ENDPOINTS.ai.exportData);
      saveBlob(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        'flick-ai-data.json',
      );
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't download your AI data."));
    }
  };

  const clear = async (): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.ai.clearData);
      notify.success('Your AI data was cleared.');
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't clear your AI data."));
    } finally {
      setConfirmClear(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-base-content/10 pt-3">
      <div>
        <p className="font-semibold">AI use today</p>
        {usage ? (
          <>
            <p className="text-sm text-[var(--text-2)]">
              {usage.used} of {usage.limit} requests. Resets at midnight UTC.
            </p>
            <progress
              className="progress progress-primary mt-1 w-full"
              value={usagePercent(usage.used, usage.limit)}
              max={100}
              aria-label="AI requests used today"
            />
            <ul className="mt-2 space-y-0.5 text-sm">
              {usage.by_feature.map((f) => (
                <li key={f.feature} className="flex justify-between">
                  <span>{featureLabel(f.feature)}</span>
                  <span className="text-[var(--text-2)]">{f.count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-[var(--text-2)]">Loading…</p>
        )}
      </div>

      <fieldset>
        <legend className="font-semibold">AI speed</legend>
        <div className="mt-1 flex gap-2">
          {(['fast', 'quality'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => void chooseSpeed(s)}
              className={`pill-tab min-h-[44px] px-4 ${speed === s ? 'bg-sunken text-primary-text font-semibold' : ''}`}
            >
              {s === 'fast' ? 'Fast' : 'Best quality'}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => void download()}>Download my AI data</ActionButton>
        {confirmClear ? (
          <ActionButton tone="danger" onClick={() => void clear()}>
            Yes, clear it
          </ActionButton>
        ) : (
          <ActionButton
            tone="danger"
            onClick={() => {
              setConfirmClear(true);
            }}
          >
            Clear my AI data
          </ActionButton>
        )}
      </div>
    </div>
  );
};
