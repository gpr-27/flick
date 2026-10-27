import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useState } from 'react';
import { X } from 'lucide-react';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { conversationTitle } from '@/features/chat/conversationView';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { oneHourFrom, parsePicked, pickableRange, presets, toInputValue } from './times';

/** Pick a time for the text in the composer; the server sends it then (see the worker). */
export const ScheduleDialog = ({
  conversation,
  text,
  open,
  onClose,
  onScheduled,
}: {
  conversation: ConversationSummary;
  text: string;
  open: boolean;
  onClose: () => void;
  /** The message is saved on the server: the composer can clear its text. */
  onScheduled: () => void;
}) => {
  // Read once, when the composer mounts this component for a new dialog (see MessageInput).
  const [now] = useState(() => new Date());
  const { min, max } = pickableRange(now);
  const [value, setValue] = useState(() => toInputValue(oneHourFrom(now)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    const picked = parsePicked(value, new Date());
    if (!picked.ok) {
      setError(picked.error);
      return;
    }
    setSaving(true);
    try {
      await getApi().call(ENDPOINTS.scheduled.create, {
        params: { conversation_id: conversation.id },
        body: { text: text.trim(), send_at: picked.at.toISOString() },
      });
      notify.success(`Scheduled for ${picked.at.toLocaleString()}`);
      onScheduled();
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't schedule the message."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="schedule-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="schedule-title" className="font-display text-xl font-bold">
          Schedule send
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
      <p className="mb-1 text-sm text-base-content/70">To {conversationTitle(conversation)}</p>
      <p className="mb-4 line-clamp-3 rounded-xl bg-base-content/5 px-3 py-2 text-sm">
        {stripMarkdown(text)}
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {presets(now).map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => {
              setValue(toInputValue(p.at));
              setError(null);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label className="mb-1 block text-sm font-semibold" htmlFor="schedule-at">
        Send at
      </label>
      <input
        id="schedule-at"
        type="datetime-local"
        className="input-soft w-full max-sm:text-base"
        value={value}
        min={toInputValue(min)}
        max={toInputValue(max)}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-error">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <Button variant="gradient" onClick={() => void submit()} loading={saving}>
          Schedule
        </Button>
      </div>
    </Modal>
  );
};
