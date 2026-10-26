import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/api';
import { ChatStylePicker } from './ChatStylePicker';
import { getStyleProfile, refreshStyleProfile, useGhostSetting } from './writingApi';

/** In the bar's settings popover: style for this chat, "my voice", and "Suggest as I type". */
export const WritingSettings = ({ conversationId }: { conversationId: string }) => {
  const [ghost, setGhost] = useGhostSetting();
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getStyleProfile()
      .then((p) => {
        if (live) setSummary(p.summary);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const learn = (): void => {
    setBusy(true);
    setError(null);
    refreshStyleProfile()
      .then((p) => {
        setSummary(p.summary);
      })
      .catch((e: unknown) => {
        setError(getErrorMessage(e, 'Could not learn your style.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <ChatStylePicker conversationId={conversationId} />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-[var(--text-2)]">My voice</span>
        <p className="text-xs text-[var(--text-2)]">
          {summary ??
            'Flick can learn how you write from your last 50 messages and reply like you.'}
        </p>
        <button type="button" className="btn btn-xs self-start" disabled={busy} onClick={learn}>
          {busy ? 'Learning…' : summary ? 'Update' : 'Learn my style'}
        </button>
        {error && (
          <p role="alert" className="text-xs text-error">
            {error}
          </p>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--text-2)]">
        Suggest as I type
        <input
          type="checkbox"
          className="toggle toggle-sm"
          checked={ghost}
          onChange={(e) => {
            setGhost(e.target.checked);
          }}
        />
      </label>
    </>
  );
};
