import { useState } from 'react';
import { X } from 'lucide-react';
import { ENDPOINTS, LIMITS } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { toInputValue } from '@/features/scheduled/times';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { useReminderStore } from './reminderStore';
import { describeWhen, parsePicked, pickableRange, presets } from './times';

/** What to be reminded about: one message, or (without a message id) the whole chat. */
export interface ReminderTarget {
  conversationId: string;
  messageId?: string;
}

interface Props {
  target: ReminderTarget;
  /** A short line shown so the person sees what the reminder is for. */
  preview: string;
  open: boolean;
  /** Starts the note field with this text (the "/remind call mom" command). */
  initialNote?: string;
  /** Starts the time field at this ISO time (a time Flick found in the message). */
  initialAt?: string;
  onClose: () => void;
  /** Tests fix the clock here; the app leaves it out. */
  now?: Date;
}

/** "Remind me": quick times, a date-time field and an optional note. The worker delivers it. */
export const ReminderDialog = (props: Props) =>
  // Mounted only while open, so the clock and the form start fresh every time.
  props.open ? <ReminderContent {...props} /> : null;

const ReminderContent = ({
  target,
  preview,
  onClose,
  initialNote,
  initialAt,
  now: fixedNow,
}: Props) => {
  const [mountedAt] = useState(() => fixedNow ?? new Date());
  const { min, max } = pickableRange(mountedAt);
  const quick = presets(mountedAt);
  const [value, setValue] = useState(() =>
    toInputValue(initialAt ? new Date(initialAt) : (quick[0] ?? { at: mountedAt }).at),
  );
  const [note, setNote] = useState((initialNote ?? '').slice(0, LIMITS.MAX_REMINDER_NOTE_LENGTH));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    const clock = fixedNow ?? new Date();
    const picked = parsePicked(value, clock);
    if (!picked.ok) {
      setError(picked.error);
      return;
    }
    setSaving(true);
    try {
      const created = await getApi().call(ENDPOINTS.reminders.create, {
        body: {
          ...(target.messageId
            ? { message_id: target.messageId }
            : { conversation_id: target.conversationId }),
          remind_at: picked.at.toISOString(),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      useReminderStore.getState().add(created);
      notify.success(`We'll remind you ${describeWhen(picked.at, clock)}`);
      onClose();
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't set the reminder."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="remind-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="remind-title" className="font-display text-xl font-bold">
          Remind me
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

      <div className="mb-3 flex flex-wrap gap-2">
        {quick.map((p) => (
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

      <label className="mb-1 block text-sm font-semibold" htmlFor="remind-at">
        Remind me at
      </label>
      <input
        id="remind-at"
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

      <label className="mb-1 mt-3 block text-sm font-semibold" htmlFor="remind-note">
        Note <span className="font-normal text-base-content/60">(optional)</span>
      </label>
      <input
        id="remind-note"
        type="text"
        className="input-soft w-full max-sm:text-base"
        value={note}
        maxLength={LIMITS.MAX_REMINDER_NOTE_LENGTH}
        placeholder="What do you need to do?"
        onChange={(e) => {
          setNote(e.target.value);
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
          Set reminder
        </Button>
      </div>
    </Modal>
  );
};
