import { useEffect, useState } from 'react';
import { Bell, CalendarClock, Send, X } from 'lucide-react';
import { ENDPOINTS, type AiAction } from '@chat/contracts';
import { Modal, Spinner, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { conversationTitle } from '@/features/chat/conversationView';
import { useChatStore } from '@/features/chat/useChatStore';
import { useReminderStore } from '@/features/reminders/reminderStore';
import { planActions } from './writingApi';

interface Card extends AiAction {
  status: 'ready' | 'done' | 'failed';
  note?: string;
}

const whenLabel = (iso: string | null, said: string): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      })
    : said
      ? `"${said}": could not read the time`
      : 'No time given';

/** The chat a "message Ravi ..." card goes to: a chat whose name matches, else this chat. */
const targetChat = (to: string | null, currentId: string): { id: string; name: string } => {
  const chats = Object.values(useChatStore.getState().conversations);
  const wanted = to?.trim().toLowerCase();
  const found = wanted
    ? (chats.find((c) => conversationTitle(c).toLowerCase() === wanted) ??
      chats.find((c) => conversationTitle(c).toLowerCase().includes(wanted)))
    : undefined;
  const chat = found ?? chats.find((c) => c.id === currentId);
  return { id: chat?.id ?? currentId, name: chat ? conversationTitle(chat) : 'this chat' };
};

/**
 * "Do it for me": a sentence like "remind me Friday 6pm to call mom and message Ravi tomorrow 9am
 * that I will be late" becomes cards. Nothing happens until you confirm; the cards then use the
 * normal reminders and scheduled-message calls.
 */
export const DoForMeDialog = ({
  open,
  request,
  conversationId,
  onClose,
}: {
  open: boolean;
  request: string;
  conversationId: string;
  onClose: () => void;
}) => {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A new request starts from a clean slate (adjusted during render, not in an effect).
  const planKey = open && request.trim() ? request : null;
  const [prevPlanKey, setPrevPlanKey] = useState(planKey);
  if (prevPlanKey !== planKey) {
    setPrevPlanKey(planKey);
    if (planKey !== null) {
      setCards(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open || !request.trim()) return;
    let live = true;
    planActions(request)
      .then((r) => {
        if (live) setCards(r.actions.map((a) => ({ ...a, status: 'ready' })));
      })
      .catch((e: unknown) => {
        if (live) setError(getErrorMessage(e, 'Flick could not read that.'));
      });
    return () => {
      live = false;
    };
  }, [open, request]);

  const run = async (card: Card): Promise<Card> => {
    if (!card.when) return { ...card, status: 'failed', note: 'No time' };
    try {
      if (card.kind === 'reminder') {
        const created = await getApi().call(ENDPOINTS.reminders.create, {
          body: {
            conversation_id: conversationId,
            remind_at: card.when,
            note: card.text.slice(0, 200),
          },
        });
        useReminderStore.getState().add(created);
      } else {
        await getApi().call(ENDPOINTS.scheduled.create, {
          params: { conversation_id: targetChat(card.to, conversationId).id },
          body: { text: card.text, send_at: card.when },
        });
      }
      return { ...card, status: 'done' };
    } catch (e) {
      return { ...card, status: 'failed', note: getErrorMessage(e, 'Could not save.') };
    }
  };

  const confirm = async (only?: number): Promise<void> => {
    if (!cards) return;
    setBusy(true);
    const next = [...cards];
    for (const [i, card] of next.entries()) {
      if ((only === undefined || only === i) && card.status !== 'done') next[i] = await run(card);
    }
    setCards(next);
    setBusy(false);
    if (next.every((c) => c.status === 'done')) {
      notify.success(next.length === 1 ? 'Done.' : `Done: ${next.length} things set up.`);
      onClose();
    }
  };

  const pending = cards?.filter((c) => c.status !== 'done' && c.when).length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Do it for me"
      overlayClassName="max-sm:items-end sm:p-4"
      className="w-full sm:w-[28rem]"
    >
      <div className="glass-card flex flex-col gap-3 rounded-t-3xl border border-base-content/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm shadow-2xl sm:rounded-2xl">
        <h2 className="text-base font-semibold">Do it for me</h2>
        {!cards && !error && <Spinner size="sm" label="Reading your request" />}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {cards?.length === 0 && (
          <p>Flick found nothing to do. Try "remind me tomorrow 9am to ...".</p>
        )}
        <ul className="flex flex-col gap-2">
          {cards?.map((c, i) => (
            <li key={i} className="flex items-start gap-2 rounded-xl bg-sunken p-3">
              {c.kind === 'reminder' ? (
                <Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--text-2)]">
                  {c.kind === 'reminder'
                    ? 'Reminder'
                    : `Message to ${targetChat(c.to, conversationId).name}`}
                </p>
                <p className="break-words">{c.text}</p>
                <p className={c.when ? 'text-xs text-[var(--text-2)]' : 'text-xs text-error'}>
                  {whenLabel(c.when, c.when_text)}
                </p>
                {c.status === 'done' && <p className="text-xs text-success">Done</p>}
                {c.status === 'failed' && c.note && (
                  <p role="alert" className="text-xs text-error">
                    {c.note}
                  </p>
                )}
              </div>
              {c.status !== 'done' && (
                <button
                  type="button"
                  aria-label="Remove"
                  className="btn btn-circle btn-ghost btn-xs"
                  onClick={() => {
                    setCards(cards.filter((_, j) => j !== i));
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost h-12 flex-1" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary h-12 flex-1 gap-1"
            disabled={busy || pending === 0}
            onClick={() => void confirm()}
          >
            <Send className="size-4" aria-hidden="true" />
            {pending > 1 ? 'Confirm all' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
