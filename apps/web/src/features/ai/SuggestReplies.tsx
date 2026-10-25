import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { suggestReplies } from './aiApi';
import { ModelTag } from './ModelTag';
import { useAiEnabled } from './useAiEnabled';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; replies: string[]; model: string }
  | { status: 'error'; message: string };

/** A "Suggest replies" button; the three suggestions appear as chips that fill the composer. */
export const SuggestReplies = ({
  conversationId,
  onPick,
}: {
  conversationId: string;
  onPick: (text: string) => void;
}) => {
  const enabled = useAiEnabled();
  const [state, setState] = useState<State>({ status: 'idle' });

  const load = (): void => {
    setState({ status: 'loading' });
    suggestReplies(conversationId)
      .then(({ replies, model }) => {
        setState({ status: 'ready', replies, model });
      })
      .catch((error: unknown) => {
        setState({
          status: 'error',
          message: getErrorMessage(error, 'Could not get suggestions.'),
        });
      });
  };

  return (
    // One line on phones: the chips scroll sideways instead of wrapping into more rows.
    <div className="scroll-slim mb-2 flex items-center gap-2 max-sm:flex-nowrap max-sm:overflow-x-auto sm:flex-wrap">
      <button
        type="button"
        onClick={load}
        disabled={enabled !== true || state.status === 'loading'}
        title={enabled === false ? 'AI is not set up on this server' : 'Suggest 3 replies'}
        className="btn btn-xs btn-ghost shrink-0 gap-1 text-base-content/70 max-sm:min-h-[44px]"
      >
        {state.status === 'loading' ? (
          <Spinner size="xs" label="Getting suggestions" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        Suggest replies
      </button>
      {enabled === false && <span className="text-xs text-base-content/50">AI not configured</span>}
      {state.status === 'error' && (
        <span role="alert" className="text-xs text-error">
          {state.message}
        </span>
      )}
      {state.status === 'ready' &&
        state.replies.map((reply) => (
          <button
            key={reply}
            type="button"
            onClick={() => {
              onPick(reply);
              setState({ status: 'idle' });
            }}
            className="chip shrink-0 cursor-pointer whitespace-nowrap hover:bg-primary/15 max-sm:min-h-[44px]"
          >
            {reply}
          </button>
        ))}
      {state.status === 'ready' && <ModelTag label={state.model} className="w-full" />}
    </div>
  );
};
