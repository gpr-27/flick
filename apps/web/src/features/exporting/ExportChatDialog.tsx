import { useState } from 'react';
import { X } from 'lucide-react';
import type { ConversationSummary } from '@chat/contracts';
import { Button, Modal, notify } from '@/components/ui';
import { conversationTitle } from '@/features/chat/conversationView';
import { useChatStore, userName } from '@/features/chat/useChatStore';
import { saveBlob } from '@/features/settings/exportData';
import { getErrorMessage } from '@/lib/api';
import { exportZip, fetchAllMessages, transcript } from './exportChat';

/** Asks for the format, shows how many messages were read so far, then downloads the file. */
export const ExportChatDialog = ({
  conversation,
  open,
  onClose,
}: {
  conversation: ConversationSummary;
  open: boolean;
  onClose: () => void;
}) => {
  const [json, setJson] = useState(false);
  const [zip, setZip] = useState(false);
  const [files, setFiles] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null); // null = not running
  const title = conversationTitle(conversation);

  const run = async (): Promise<void> => {
    setCount(0);
    try {
      const messages = await fetchAllMessages(conversation.id, setCount);
      const users = useChatStore.getState().users;
      const base = `flick-chat-${title.replace(/[^\w-]+/g, '_')}`;
      if (zip) {
        const text = transcript(messages, (id) => userName(users, id));
        const blob = await exportZip(messages, text, (done, total) => {
          setFiles(`${String(done)} of ${String(total)}`);
        });
        saveBlob(blob, `${base}.zip`);
      } else if (json) {
        saveBlob(
          new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' }),
          `${base}.json`,
        );
      } else {
        const text = transcript(messages, (id) => userName(users, id));
        saveBlob(new Blob([text], { type: 'text/plain' }), `${base}.txt`);
      }
      onClose();
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't export this chat."));
    } finally {
      setCount(null);
      setFiles(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="export-chat-title"
      className="glass-card mx-4 w-full max-w-sm rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 id="export-chat-title" className="font-display text-xl font-bold">
          Export chat
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
      <p className="mb-3 text-sm">
        Download this chat as a text file with times, names and file names.
      </p>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={json}
          onChange={(e) => {
            setJson(e.target.checked);
          }}
        />
        JSON instead of text
      </label>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={zip}
          onChange={(e) => {
            setZip(e.target.checked);
          }}
        />
        Zip with photos, videos and files
      </label>
      {files && (
        <p role="status" className="mb-3 text-sm">
          Downloading files… {files}
        </p>
      )}
      {count !== null && (
        <p role="status" className="mb-3 text-sm">
          Reading messages… {count}
        </p>
      )}
      <Button variant="gradient" loading={count !== null} onClick={() => void run()}>
        Export
      </Button>
    </Modal>
  );
};
