import { useState } from 'react';
import { Timer, X } from 'lucide-react';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { Modal, notify } from '@/components/ui';
import { useChatStore } from '@/features/chat/useChatStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { TIMER_OPTIONS, timerLabel } from './disappearing';

/** Header button + dialog to choose how long new messages in this chat live. */
export const DisappearingMenu = ({ conversation }: { conversation: ConversationSummary }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = conversation.settings.disappearing_timer_s;

  const choose = async (seconds: number): Promise<void> => {
    if (seconds === current) return;
    setSaving(true);
    try {
      const summary = await getApi().call(ENDPOINTS.conversations.update, {
        params: { conversation_id: conversation.id },
        body: { settings: { disappearing_timer_s: seconds } },
      });
      useChatStore.getState().conversationUpdated(conversation.id, summary);
      setOpen(false);
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't change the timer."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="btn btn-circle btn-ghost btn-sm text-base-content/70 hover:text-primary"
        aria-label={`Disappearing messages: ${timerLabel(current)}`}
        title="Disappearing messages"
      >
        <Timer className="size-5" aria-hidden="true" />
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        labelledBy="disappearing-title"
        className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="disappearing-title" className="font-display text-xl font-bold">
            Disappearing messages
          </h2>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            className="btn btn-circle btn-ghost btn-sm"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-3 text-sm text-base-content/70">
          New messages in this chat disappear after the time you choose.
        </p>
        <div role="radiogroup" aria-label="Timer" className="space-y-1">
          {TIMER_OPTIONS.map((option) => (
            <label key={option.seconds} className="flex cursor-pointer items-center gap-3 py-1.5">
              <input
                type="radio"
                name="disappearing-timer"
                className="radio radio-sm"
                checked={current === option.seconds}
                disabled={saving}
                onChange={() => void choose(option.seconds)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </Modal>
    </>
  );
};
