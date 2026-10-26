import { lazy, Suspense, useState } from 'react';
import { messageHint, looksCheckable } from './heuristics';
import { useAiEnabled } from '@/features/ai/useAiEnabled';

const CheckDialog = lazy(() =>
  import('./UnderstandDialogs').then((m) => ({ default: m.CheckDialog })),
);

/**
 * Under an incoming text message: a small badge when it looks urgent or upset (local keyword check,
 * nothing is sent anywhere), and a "Check this" chip for messages with a link or a claim.
 * Tapping either asks Flick, only then.
 */
export const MessageHints = ({
  conversationId,
  messageId,
  text,
}: {
  conversationId: string;
  messageId: string;
  text: string;
}) => {
  const enabled = useAiEnabled();
  const [aspect, setAspect] = useState<'facts' | 'mood' | null>(null);
  const [last, setLast] = useState<'facts' | 'mood'>('mood');
  const hint = messageHint(text);
  const checkable = enabled === true && looksCheckable(text);
  if (!hint && !checkable) return null;
  const open = (a: 'facts' | 'mood'): void => {
    setLast(a);
    setAspect(a);
  };
  const chip =
    'rounded-full border border-base-content/15 px-2 py-0.5 text-xs font-medium text-[var(--text-2)] hover:bg-[var(--bg-hover)]';
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {hint && (
        <button
          type="button"
          className={chip}
          title={enabled === true ? 'Check with AI' : undefined}
          disabled={enabled !== true}
          onClick={() => {
            open('mood');
          }}
        >
          {hint === 'urgent' ? 'Looks urgent' : 'Sounds upset'}
          {enabled === true ? ' · Check with AI' : ''}
        </button>
      )}
      {checkable && (
        <button
          type="button"
          className={chip}
          onClick={() => {
            open('facts');
          }}
        >
          Check this
        </button>
      )}
      {aspect !== null && (
        <Suspense fallback={null}>
          <CheckDialog
            conversationId={conversationId}
            messageId={messageId}
            aspect={last}
            open
            onClose={() => {
              setAspect(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};
