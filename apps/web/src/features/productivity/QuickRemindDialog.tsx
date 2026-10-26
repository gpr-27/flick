import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { describeWhen, presets } from '@/features/reminders/times';
import { useReminderStore } from '@/features/reminders/reminderStore';
import { ReminderDialog } from '@/features/reminders/ReminderDialog';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

interface Props {
  conversationId: string;
  messageId: string;
  preview: string;
  onClose: () => void;
}

/**
 * "Remind me about this": later today, tomorrow, next week, custom, or let Flick read the time
 * from the message. Custom and Flick's suggestion open the full ReminderDialog, prefilled.
 */
export const QuickRemindDialog = ({ conversationId, messageId, preview, onClose }: Props) => {
  const [now] = useState(() => new Date());
  const ai = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState<{ at?: string; note?: string } | null>(null);

  const quick = async (at: Date): Promise<void> => {
    setBusy(true);
    try {
      const created = await getApi().call(ENDPOINTS.reminders.create, {
        body: { message_id: messageId, remind_at: at.toISOString() },
      });
      useReminderStore.getState().add(created);
      notify.success(`We'll remind you ${describeWhen(at, now)}`);
      onClose();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't set the reminder."));
      setBusy(false);
    }
  };

  const suggest = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await getApi().call(ENDPOINTS.productivity.extractReminder, {
        body: { message_id: messageId },
      });
      setFull({ at: r.remind_at ?? undefined, note: r.title });
    } catch (e) {
      notify.error(getErrorMessage(e, "Flick couldn't read this message."));
    } finally {
      setBusy(false);
    }
  };

  if (full) {
    return (
      <ReminderDialog
        open
        target={{ conversationId, messageId }}
        preview={preview}
        initialNote={full.note}
        initialAt={full.at}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="quick-remind-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="quick-remind-title" className="font-display text-xl font-bold">
          Remind me about this
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-circle btn-ghost btn-sm"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <p className="mb-4 line-clamp-3 rounded-xl bg-base-content/5 px-3 py-2 text-sm">{preview}</p>
      <div className="flex flex-col gap-2">
        {presets(now).map((p) => (
          <Button
            key={p.label}
            variant="secondary"
            disabled={busy}
            onClick={() => void quick(p.at)}
          >
            {p.label}
          </Button>
        ))}
        <Button variant="secondary" disabled={busy} onClick={() => setFull({})}>
          Custom…
        </Button>
        {ai && (
          <Button variant="primary" disabled={busy} onClick={() => void suggest()}>
            <Sparkles className="size-4" aria-hidden="true" /> Let Flick pick the time
          </Button>
        )}
      </div>
    </Modal>
  );
};
