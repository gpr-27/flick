import { Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { composeText } from './aiApi';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';

/**
 * Shown while the box holds "@flick <instruction>" in a person-to-person chat. Instead of
 * sending the instruction, this asks Flick to write the message and puts it in the box.
 */
export const WriteThisWithFlick = ({
  instruction,
  onWritten,
}: {
  instruction: string;
  onWritten: (text: string) => void;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const loading = task.state.status === 'loading';

  if (enabled !== true) return null;

  const write = (): void => {
    void task
      .run(
        async ({ signal }) =>
          (await composeText({ mode: 'write', text: instruction }, signal)).text,
      )
      .then((text) => {
        if (text) onWritten(text);
      });
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={write}
        disabled={loading}
        className="btn btn-xs btn-primary btn-outline gap-1 max-sm:min-h-[44px]"
      >
        {loading ? (
          <Spinner size="xs" label="Flick is writing" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        Write this with Flick
      </button>
      <span className="text-xs text-base-content/60">Fills the box. Nothing is sent.</span>
      {task.state.status === 'error' && (
        <span role="alert" className="text-xs text-error">
          {task.state.error}
        </span>
      )}
    </div>
  );
};
