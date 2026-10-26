import { useState } from 'react';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiEnabled } from '../useAiEnabled';
import { runTool } from './writingApi';

/** "Write my bio": Flick turns what is in About (or a few hints) into a short bio. */
export const WriteBioButton = ({
  about,
  hint,
  max,
  onWrite,
}: {
  about: string;
  /** Facts to use when About is empty, e.g. the person's name. */
  hint: string;
  max: number;
  onWrite: (bio: string) => void;
}) => {
  const enabled = useAiEnabled();
  const [busy, setBusy] = useState(false);
  if (enabled !== true) return null;
  return (
    <button
      type="button"
      className="chip min-h-[44px] rounded-full px-3 text-sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        runTool('bio', about.trim() || hint || 'a friendly person')
          .then((bio) => {
            onWrite(bio.slice(0, max));
          })
          .catch((e: unknown) => {
            notify.error(getErrorMessage(e, 'Could not write a bio.'));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      {busy ? 'Writing…' : 'Write my bio'}
    </button>
  );
};
