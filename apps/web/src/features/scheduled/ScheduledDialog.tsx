import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { ENDPOINTS, type ScheduledMessage } from '@chat/contracts';
import { Modal, Spinner, notify } from '@/components/ui';
import { conversationTitle } from '@/features/chat/conversationView';
import { useChatStore } from '@/features/chat/useChatStore';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

/** Messages waiting to be sent (or that could not be sent), with a cancel button on each. */
export const ScheduledDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) =>
  open ? <ScheduledContent onClose={onClose} /> : null;

// Mounted only while the dialog is open, so it loads a fresh list every time and never shows a stale one.
const ScheduledContent = ({ onClose }: { onClose: () => void }) => {
  const conversations = useChatStore((s) => s.conversations);
  const [items, setItems] = useState<ScheduledMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.scheduled.list)
      .then(
        (res) => {
          if (!cancelled) setItems(res.items);
        },
        (e: unknown) => {
          if (!cancelled) setError(getErrorMessage(e, "Couldn't load your scheduled messages."));
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const cancel = async (item: ScheduledMessage): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.scheduled.cancel, { params: { scheduled_id: item.id } });
      setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't cancel that message."));
    }
  };

  const chatName = (id: string): string => {
    const c = conversations[id];
    return c ? conversationTitle(c) : 'a chat';
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="scheduled-title"
      className="glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="scheduled-title" className="font-display text-xl font-bold">
          Scheduled
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

      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : items === null ? (
        <Spinner size="sm" label="Loading" />
      ) : items.length === 0 ? (
        <p className="py-2 text-sm text-base-content/60">
          Nothing scheduled. Hold the send button (or right-click it) to schedule a message.
        </p>
      ) : (
        <ul className="scroll-slim max-h-80 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-2xl bg-base-content/5 p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">To {chatName(item.conversation_id)}</p>
                <p className="line-clamp-2 break-words">{item.text}</p>
                {item.status === 'failed' ? (
                  <p className="mt-1 font-semibold text-error">
                    Not sent: {item.failed_reason ?? 'something went wrong'}
                  </p>
                ) : (
                  <p className="mt-1 text-base-content/60">
                    {new Date(item.send_at).toLocaleString()}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="btn btn-circle btn-ghost btn-sm"
                aria-label={`Cancel scheduled message to ${chatName(item.conversation_id)}`}
                onClick={() => void cancel(item)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};
