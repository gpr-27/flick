import { useEffect, useMemo, useState } from 'react';
import { Copy, Forward, Star, Trash2, X } from 'lucide-react';
import type { MessageRecord } from '@chat/contracts';
import { Modal, notify } from '@/components/ui';
import { ForwardModal } from '../../organise/ForwardModal';
import { toggleStar } from '../../organise/messageActions';
import { useChatStore } from '../useChatStore';
import { planSelection } from './selectionRules';
import { useSelectionStore } from './useSelectionStore';

const iconButton = 'btn btn-circle btn-ghost size-11 min-h-11 disabled:opacity-40';

/**
 * Replaces the chat header while several messages are chosen: how many, and what can be done
 * with them (copy, forward, star, delete). Reply is left out on purpose: it needs exactly one.
 */
export const SelectionBar = ({
  messages,
  ids,
  myId,
}: {
  /** The open thread, oldest first. */
  messages: readonly MessageRecord[];
  ids: readonly string[];
  myId: string;
}) => {
  const clear = useSelectionStore((s) => s.clear);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const [forwarding, setForwarding] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Kept in thread order, so copy and forward read the way the chat does.
  const selected = useMemo(() => {
    const chosen = new Set(ids);
    return messages.filter((m) => chosen.has(m.message_id));
  }, [messages, ids]);
  const plan = planSelection(selected, myId);

  // Everything chosen was deleted (say, by its sender): nothing left to act on.
  useEffect(() => {
    if (selected.length === 0) clear();
  }, [selected.length, clear]);

  // Escape ends the selection, unless a dialog from here is open (Escape closes that instead).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !forwarding && !deleting && !e.defaultPrevented) clear();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [clear, forwarding, deleting]);

  const copy = async (): Promise<void> => {
    if (plan.copyText === null) return;
    try {
      await navigator.clipboard.writeText(plan.copyText);
      notify.success('Copied');
      clear();
    } catch {
      notify.error("Couldn't copy");
    }
  };

  const star = (): void => {
    for (const m of plan.starTargets) void toggleStar(m);
    clear();
  };

  const remove = (scope: 'me' | 'everyone'): void => {
    for (const m of selected) void deleteMessage(m, scope);
    setDeleting(false);
    clear();
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected messages"
        className="glass flex items-center gap-1 border-b border-base-content/10 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]"
      >
        <button type="button" onClick={clear} className={iconButton} aria-label="Cancel selection">
          <X className="size-5" aria-hidden="true" />
        </button>
        <p className="flex-1 px-2 font-display text-lg font-bold" role="status">
          {plan.count} selected
        </p>
        {plan.copyText !== null && (
          <button
            type="button"
            onClick={() => void copy()}
            className={iconButton}
            aria-label="Copy"
            title="Copy"
          >
            <Copy className="size-5" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setForwarding(true);
          }}
          disabled={plan.forwardable.length === 0}
          className={iconButton}
          aria-label="Forward"
          title="Forward"
        >
          <Forward className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={star}
          className={iconButton}
          aria-label={plan.starAction === 'star' ? 'Star' : 'Unstar'}
          title={plan.starAction === 'star' ? 'Star' : 'Unstar'}
        >
          <Star
            className={plan.starAction === 'unstar' ? 'size-5 fill-current' : 'size-5'}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleting(true);
          }}
          className={`${iconButton} text-error`}
          aria-label="Delete"
          title="Delete"
        >
          <Trash2 className="size-5" aria-hidden="true" />
        </button>
      </div>

      <ForwardModal
        message={null}
        messages={forwarding ? plan.forwardable : []}
        onClose={() => {
          setForwarding(false);
          clear();
        }}
      />

      <Modal
        open={deleting}
        onClose={() => {
          setDeleting(false);
        }}
        labelledBy="delete-selected-title"
        className="glass-card mx-4 flex w-full max-w-sm flex-col gap-1 rounded-3xl p-4 animate-scale-in"
      >
        <h2 id="delete-selected-title" className="px-2 py-2 font-display text-lg font-bold">
          Delete {plan.count === 1 ? 'this message' : `${plan.count} messages`}?
        </h2>
        <button
          type="button"
          className="btn btn-ghost justify-start"
          onClick={() => {
            remove('me');
          }}
        >
          Delete for me
        </button>
        {plan.canDeleteForEveryone && (
          <button
            type="button"
            className="btn btn-ghost justify-start text-error"
            onClick={() => {
              remove('everyone');
            }}
          >
            Delete for everyone
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost justify-start"
          onClick={() => {
            setDeleting(false);
          }}
        >
          Cancel
        </button>
      </Modal>
    </>
  );
};
