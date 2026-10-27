import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useFeatureGuide } from '@/features/guide/useFeatureGuide';
import { markUsed } from '@/features/guide/useGuideStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { suggestReplies } from './aiApi';
import { SummariseChatDialog } from './ChatAiDialogs';
import { SortSuggestion } from '../lists/SortSuggestion';
import { CatchUpCard } from '../understand/CatchUpCard';
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
  const [summaryOpen, setSummaryOpen] = useState(false);
  const unread = useChatStore((s) => s.conversations[conversationId]?.unread_count ?? 0);
  useFeatureGuide('ai.suggest', enabled === true);

  const load = (): void => {
    markUsed('ai.suggest');
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
    <div data-guide="ai.suggest" className="mb-2">
      <SortSuggestion conversationId={conversationId} />
      {enabled === true && unread >= 8 && (
        <CatchUpCard conversationId={conversationId} unread={unread} />
      )}
      {/* One tidy row: the button, then the chips. On phones it scrolls sideways instead of wrapping. */}
      <div className="scroll-slim flex items-center gap-2 max-sm:overflow-x-auto sm:flex-wrap">
        <button
          type="button"
          onClick={load}
          disabled={enabled !== true || state.status === 'loading'}
          title={enabled === false ? 'AI is not set up on this server' : 'Suggest 3 replies'}
          className="btn btn-xs h-8 shrink-0 gap-1.5 rounded-full border-base-content/15 bg-transparent px-3 font-medium text-[var(--text-2)] hover:border-primary/40 hover:bg-[var(--bg-active)] max-sm:min-h-[44px]"
        >
          {state.status === 'loading' ? (
            <Spinner size="xs" label="Getting suggestions" />
          ) : (
            <Sparkles className="size-3.5 text-primary-text" aria-hidden="true" />
          )}
          Suggest replies
        </button>
        {enabled === true && unread >= 5 && (
          <button
            type="button"
            onClick={() => {
              setSummaryOpen(true);
            }}
            className="btn btn-xs h-8 shrink-0 gap-1.5 rounded-full border-base-content/15 bg-transparent px-3 font-medium text-[var(--text-2)] hover:border-primary/40 hover:bg-[var(--bg-active)] max-sm:min-h-[44px]"
          >
            Summarise {unread} unread
          </button>
        )}
        {enabled === false && (
          <span className="shrink-0 text-xs text-[var(--text-2)]">AI not configured</span>
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
              className="chip h-8 min-w-0 max-w-[18rem] shrink-0 cursor-pointer whitespace-nowrap border border-base-content/10 px-3 text-sm font-medium hover:bg-[var(--bg-active)] max-sm:min-h-[44px]"
            >
              <span className="truncate">{stripMarkdown(reply)}</span>
            </button>
          ))}
      </div>
      {state.status === 'error' && (
        <p role="alert" className="mt-1 text-xs text-error">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && <ModelTag label={state.model} className="mt-1" />}
      <SummariseChatDialog
        conversationId={conversationId}
        open={summaryOpen}
        onClose={() => {
          setSummaryOpen(false);
        }}
      />
    </div>
  );
};
