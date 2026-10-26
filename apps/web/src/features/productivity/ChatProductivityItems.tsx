import { useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

const itemClass =
  'w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none disabled:opacity-40 max-sm:min-h-[44px]';

/** Chat options: "Create event…" and "Make meeting notes" (saved to Saved messages). */
export const ChatProductivityItems = ({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) => {
  const ai = useAiEnabled();
  const [eventOpen, setEventOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const notes = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await getApi().call(ENDPOINTS.productivity.meetingNotes, {
        body: { conversation_id: conversationId, count: 50 },
      });
      notify.success(r.saved ? 'Meeting notes saved to Saved messages' : 'Meeting notes are ready');
      onDone();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't make meeting notes."));
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => setEventOpen(true)}
      >
        Create event…
      </button>
      {ai && (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          disabled={busy}
          onClick={() => void notes()}
        >
          {busy ? 'Making notes…' : 'Make meeting notes'}
        </button>
      )}
      {eventOpen && (
        <EventDialog
          conversationId={conversationId}
          onClose={() => {
            setEventOpen(false);
            onDone();
          }}
        />
      )}
    </>
  );
};

const EventDialog = ({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) => {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const at = new Date(when);
    if (!title.trim() || Number.isNaN(at.getTime())) {
      notify.error('Give the event a title and a time.');
      return;
    }
    setBusy(true);
    try {
      await getApi().call(ENDPOINTS.productivity.createEvent, {
        body: {
          conversation_id: conversationId,
          title: title.trim(),
          starts_at: at.toISOString(),
          ...(place.trim() ? { place: place.trim() } : {}),
        },
      });
      onClose();
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't create the event."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="event-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <h2 id="event-title" className="mb-3 font-display text-xl font-bold">
        Create event
      </h2>
      <div className="flex flex-col gap-2">
        <input
          className="input-soft max-sm:text-base"
          placeholder="Title"
          maxLength={100}
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="datetime-local"
          className="input-soft max-sm:text-base"
          aria-label="When"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <input
          className="input-soft max-sm:text-base"
          placeholder="Place (optional)"
          maxLength={200}
          aria-label="Place"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Send event
          </Button>
        </div>
      </div>
    </Modal>
  );
};
