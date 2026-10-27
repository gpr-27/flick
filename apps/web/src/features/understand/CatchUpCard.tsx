import { Markdown } from '@/features/content/richText/Markdown';
import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { ItemList } from './UnderstandParts';
import { useUnderstand } from './useUnderstand';

const count = (items: { kind: string }[], kind: string): number =>
  items.filter((i) => i.kind === kind).length;

/** Shown above the composer in a busy chat: "3 decisions, 2 questions for you, 1 deadline". */
export const CatchUpCard = ({
  conversationId,
  unread,
}: {
  conversationId: string;
  unread: number;
}) => {
  const { state, run, reset } = useUnderstand();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const done = state.status === 'done' ? state.result : null;
  const parts = done
    ? (
        [
          [count(done.items, 'decision'), 'decision'],
          [count(done.items, 'question'), 'question'],
          [count(done.items, 'deadline'), 'deadline'],
        ] as const
      )
        .filter(([n]) => n > 0)
        .map(([n, k]) => `${n} ${k}${n === 1 ? '' : 's'}${k === 'question' ? ' for you' : ''}`)
    : [];
  return (
    <div className="mb-2 rounded-2xl border border-base-content/10 bg-[var(--bg-sunken)] p-3 text-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
        {state.status === 'idle' || state.status === 'error' ? (
          <button
            type="button"
            className="flex-1 text-left font-medium"
            onClick={() => {
              run({ mode: 'catchup', conversation_id: conversationId });
            }}
          >
            Catch me up on {unread} unread
          </button>
        ) : state.status === 'loading' ? (
          <Spinner size="xs" label="Catching you up" />
        ) : (
          <span className="flex-1 font-medium">{parts.join(', ') || 'Nothing needs you'}</span>
        )}
        <button
          type="button"
          aria-label="Hide"
          className="grid size-8 place-items-center rounded-full hover:bg-[var(--bg-hover)]"
          onClick={() => {
            reset();
            setHidden(true);
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="mt-1 text-xs text-error">
          {state.message}
        </p>
      )}
      {done && (
        <div className="mt-2">
          {done.text && <Markdown text={done.text} className="px-3 pb-1 text-[var(--text-2)]" />}
          <ItemList items={done.items} />
        </div>
      )}
    </div>
  );
};
