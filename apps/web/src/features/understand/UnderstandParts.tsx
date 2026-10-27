import { Markdown } from '@/features/content/richText/Markdown';
import type { ReactNode } from 'react';
import { Modal, Spinner } from '@/components/ui';
import { ModelTag } from '@/features/ai/ModelTag';
import { modelLabel } from '@/features/ai/modelLabel';
import { useJumpStore } from '@/features/organise/jump';
import type { UnderstandItem, UnderstandResult } from './understandApi';
import type { useUnderstand } from './useUnderstand';

export const Shell = ({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) => (
  <Modal
    open={open}
    onClose={onClose}
    label={title}
    className="glass-card mx-4 flex w-full max-w-md flex-col gap-3 rounded-3xl p-5 text-sm animate-scale-in"
  >
    <h2 className="font-display text-lg font-bold">{title}</h2>
    {children}
    <button type="button" className="btn btn-ghost min-h-[44px]" onClick={onClose}>
      Close
    </button>
  </Modal>
);

/** Points the model found; a tap jumps to the message when the server knew which one. */
export const ItemList = ({ items, onJump }: { items: UnderstandItem[]; onJump?: () => void }) => (
  <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
    {items.map((item, i) => {
      const jump =
        item.conversation_id && item.message_id && item.seq !== undefined
          ? { conversation_id: item.conversation_id, message_id: item.message_id, seq: item.seq }
          : null;
      return (
        <li key={`${item.message_id ?? i}-${i}`}>
          <button
            type="button"
            disabled={!jump}
            onClick={() => {
              if (!jump) return;
              onJump?.();
              useJumpStore.getState().jumpTo(jump);
            }}
            className="w-full rounded-xl px-3 py-2 text-left leading-5 enabled:hover:bg-[var(--bg-hover)]"
          >
            <Markdown text={item.text} />
          </button>
        </li>
      );
    })}
  </ul>
);

export const Result = ({
  state,
  onJump,
}: {
  state: ReturnType<typeof useUnderstand>['state'];
  onJump?: () => void;
}) => {
  if (state.status === 'loading') return <Spinner size="sm" label="Flick is reading" />;
  if (state.status === 'error')
    return (
      <p role="alert" className="text-error">
        {state.message}
      </p>
    );
  if (state.status !== 'done') return null;
  const r: UnderstandResult = state.result;
  return (
    <>
      {r.text && <Markdown text={r.text} className="leading-6" />}
      {r.items.length > 0 && <ItemList items={r.items} {...(onJump ? { onJump } : {})} />}
      {r.model && <ModelTag label={modelLabel(r.provider, r.model)} />}
    </>
  );
};
