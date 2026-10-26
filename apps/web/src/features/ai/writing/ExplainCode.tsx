import { useState } from 'react';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiEnabled } from '../useAiEnabled';
import { runTool } from './writingApi';

/** "Explain" in a code block's header: a short plain-words explanation shown under the code. */
export const ExplainCode = ({ code }: { code: string }) => {
  const enabled = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  if (enabled !== true) return null;
  return (
    <>
      <button
        type="button"
        className="text-xs underline"
        disabled={busy}
        onClick={() => {
          if (answer) {
            setAnswer(null);
            return;
          }
          setBusy(true);
          runTool('code', code.slice(0, 4_000))
            .then(setAnswer)
            .catch((e: unknown) => {
              notify.error(getErrorMessage(e, 'Could not explain this code.'));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? 'Explaining…' : answer ? 'Hide explanation' : 'Explain'}
      </button>
      {answer && (
        <p role="note" className="basis-full whitespace-pre-wrap rounded-lg bg-sunken p-2 text-xs">
          {answer}
        </p>
      )}
    </>
  );
};
