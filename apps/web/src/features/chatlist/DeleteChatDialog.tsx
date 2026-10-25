// "Delete this chat?" - the confirmation before anything is removed from the list.
import { useRef, useState } from 'react';
import type { ConversationSummary } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { dialogWording } from './deleteWording';
import { deleteChats } from './rowActions';

export const DeleteChatDialog = ({
  chats,
  onClose,
  onDone,
}: {
  /** Null while the dialog is closed. */
  chats: ConversationSummary[] | null;
  onClose: () => void;
  /** Called after the chats were deleted. */
  onDone?: () => void;
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const wording = dialogWording(chats ?? []);

  const confirm = async (): Promise<void> => {
    if (!chats) return;
    setBusy(true);
    try {
      await deleteChats(chats);
      onDone?.();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Modal
      open={chats !== null && chats.length > 0}
      onClose={onClose}
      labelledBy="delete-chat-title"
      describedBy="delete-chat-body"
      role="alertdialog"
      initialFocusRef={cancelRef}
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <h2 id="delete-chat-title" className="font-display text-xl font-bold">
        {wording.title}
      </h2>
      <p id="delete-chat-body" className="mt-2 text-sm text-base-content/70">
        {wording.body}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-error"
          disabled={busy}
          onClick={() => {
            void confirm();
          }}
        >
          {wording.confirm}
        </button>
      </div>
    </Modal>
  );
};
