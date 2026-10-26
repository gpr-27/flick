import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { Result } from './UnderstandParts';
import { useUnderstand } from './useUnderstand';
import { looksLikeQuestion } from './looksLikeQuestion';

/** In the chat-list search: answer a question from the top matching messages, with sources. */
export const AskFlickRow = ({ query }: { query: string }) => {
  const enabled = useAiEnabled();
  const { state, run, reset } = useUnderstand();
  useEffect(() => reset, [query, reset]);
  if (enabled !== true || !looksLikeQuestion(query)) return null;
  return (
    <div className="mx-4 mb-2 mt-3 flex flex-col gap-2 rounded-2xl border border-base-content/10 p-3 text-sm">
      <button
        type="button"
        className="flex items-center gap-2 text-left font-medium"
        disabled={state.status === 'loading'}
        onClick={() => {
          run({ mode: 'search', query: query.trim() });
        }}
      >
        {state.status === 'loading' ? (
          <Spinner size="xs" label="Flick is searching" />
        ) : (
          <Sparkles className="size-4 text-primary-text" aria-hidden="true" />
        )}
        Ask Flick: {query.trim()}
      </button>
      <Result state={state} />
    </div>
  );
};
