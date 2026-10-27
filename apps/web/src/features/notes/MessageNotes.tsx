import { Markdown } from '@/features/content/richText/Markdown';
import { useEffect, useState } from 'react';
import { StickyNote, X } from 'lucide-react';
import { ENDPOINTS, type EditHistory } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { formatMessageTime } from '@/lib/time';
import { useNoteStore } from './noteStore';

/** My private note under a bubble. Nobody else ever receives it. */
export const NoteChip = ({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) => {
  const note = useNoteStore((s) => s.notes[messageId]);
  const ensureLoaded = useNoteStore((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded(conversationId);
  }, [conversationId, ensureLoaded]);
  if (!note) return null;
  return (
    <p
      data-testid="note-chip"
      className="mt-1 flex max-w-full items-start gap-1 rounded-lg bg-warning/20 px-2 py-1 text-xs"
    >
      <StickyNote className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{note}</span>
    </p>
  );
};

/** Add, change or delete my note on one message. */
export const NoteDialog = ({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string;
  messageId: string;
  onClose: () => void;
}) => {
  const existing = useNoteStore((s) => s.notes[messageId]);
  const [text, setText] = useState(existing ?? '');
  const [saving, setSaving] = useState(false);

  const run = async (action: () => Promise<void>, failure: string): Promise<void> => {
    setSaving(true);
    try {
      await action();
      onClose();
    } catch (e) {
      notify.error(getErrorMessage(e, failure));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="note-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="note-title" className="font-display text-xl font-bold">
          Note
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
      <p className="mb-2 text-sm text-base-content/60">Only you can see this note.</p>
      <textarea
        aria-label="Note"
        className="input-soft min-h-24 w-full max-sm:text-base"
        value={text}
        maxLength={1000}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        {existing && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving}
            onClick={() =>
              void run(
                () => useNoteStore.getState().remove(conversationId, messageId),
                "Couldn't delete the note.",
              )
            }
          >
            Delete
          </button>
        )}
        <Button
          variant="gradient"
          disabled={saving || !text.trim()}
          onClick={() =>
            void run(
              () => useNoteStore.getState().save(conversationId, messageId, text.trim()),
              "Couldn't save the note.",
            )
          }
        >
          Save
        </Button>
      </div>
    </Modal>
  );
};

/** The text of an edited message before each edit, oldest first. */
export const EditHistoryDialog = ({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string;
  messageId: string;
  onClose: () => void;
}) => {
  const [history, setHistory] = useState<EditHistory['edits'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .call(ENDPOINTS.notes.editHistory, {
        params: { conversation_id: conversationId, message_id: messageId },
      })
      .then((res) => {
        if (!cancelled) setHistory(res.edits);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(getErrorMessage(e, "Couldn't load the edit history."));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId]);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="history-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="history-title" className="font-display text-xl font-bold">
          Edit history
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
      {error && (
        <p role="alert" className="text-sm font-semibold text-error">
          {error}
        </p>
      )}
      {!error && history === null && <p className="text-sm">Loading...</p>}
      {history?.length === 0 && <p className="text-sm">No earlier versions.</p>}
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {history?.map((e, i) => (
          <li key={i} className="rounded-xl bg-base-content/5 px-3 py-2 text-sm">
            <Markdown text={e.body_text ?? '(no text)'} />
            <p className="mt-1 text-xs text-base-content/60">
              Replaced at {formatMessageTime(e.edited_at)}
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  );
};
