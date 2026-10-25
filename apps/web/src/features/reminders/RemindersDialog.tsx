import { useEffect } from 'react';
import { Trash2, X } from 'lucide-react';
import { ENDPOINTS, type Reminder } from '@chat/contracts';
import { Modal, Spinner, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useReminderStore } from './reminderStore';

/** The person's reminders: the waiting ones with a cancel button, then the recently sent ones. */
export const RemindersDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) =>
  open ? <RemindersContent onClose={onClose} /> : null;

const whatOf = (r: Reminder): string => {
  if (r.message_gone) return 'A message you wanted to be reminded about was deleted';
  if (r.quote !== null) return `"${r.quote}"`;
  return 'This chat';
};

// Mounted only while the dialog is open, so it asks the server every time it opens.
const RemindersContent = ({ onClose }: { onClose: () => void }) => {
  const { items, status, error } = useReminderStore();
  useEffect(() => {
    void useReminderStore.getState().load();
  }, []);

  const cancel = async (item: Reminder): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.reminders.cancel, { params: { reminder_id: item.id } });
      useReminderStore.getState().remove(item.id);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't cancel that reminder."));
    }
  };

  const pending = items.filter((r) => r.status === 'pending');
  const sent = items.filter((r) => r.status === 'sent');

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="reminders-title"
      className="glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="reminders-title" className="font-display text-xl font-bold">
          Reminders
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

      {status === 'error' && items.length === 0 ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : (status === 'idle' || status === 'loading') && items.length === 0 ? (
        <Spinner size="sm" label="Loading" />
      ) : pending.length === 0 && sent.length === 0 ? (
        <p className="py-2 text-sm text-base-content/60">
          No reminders. Open a message menu and choose &quot;Remind me&quot; to set one.
        </p>
      ) : (
        <div className="scroll-slim max-h-96 space-y-4 overflow-y-auto">
          {pending.length === 0 && (
            <p className="text-sm text-base-content/60">Nothing waiting right now.</p>
          )}
          {pending.length > 0 && (
            <ul className="space-y-2" aria-label="Waiting reminders">
              {pending.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 rounded-2xl bg-base-content/5 p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{item.chat_name}</p>
                    <p className="line-clamp-2 break-words">{whatOf(item)}</p>
                    {item.author_name && !item.message_gone && (
                      <p className="text-base-content/60">from {item.author_name}</p>
                    )}
                    {item.note && <p className="mt-1 break-words italic">{item.note}</p>}
                    <p className="mt-1 text-base-content/60">
                      <time dateTime={item.remind_at}>
                        {new Date(item.remind_at).toLocaleString()}
                      </time>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-circle btn-ghost btn-sm"
                    aria-label={`Cancel reminder for ${item.chat_name}`}
                    onClick={() => void cancel(item)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {sent.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase text-base-content/60">
                Recently sent
              </h3>
              <ul className="space-y-1" aria-label="Sent reminders">
                {sent.map((item) => (
                  <li key={item.id} className="rounded-xl px-3 py-1 text-sm text-base-content/70">
                    <span className="font-semibold">{item.chat_name}</span>
                    {': '}
                    <span className="break-words">{whatOf(item)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
};
