import { useState } from 'react';
import type { MessageContent } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { useDirectory } from '@/features/directory/useDirectory';
import { contactText } from '../rich/richMessages';

/** Pick someone from the people directory and share them as a contact card. */
export const ContactDialog = ({
  onSend,
  onClose,
}: {
  onSend: (c: MessageContent) => void;
  onClose: () => void;
}) => {
  const [text, setText] = useState('');
  const dir = useDirectory(text);
  return (
    <Modal open onClose={onClose} label="Share a contact" className="w-80 p-4">
      <h2 className="mb-2 font-semibold">Share a contact</h2>
      <input
        type="search"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        placeholder="Search people…"
        aria-label="Search people"
        className="input-soft mb-2 w-full"
      />
      <ul className="max-h-64 overflow-y-auto">
        {dir.items.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-base-content/5"
              onClick={() => {
                onSend({
                  type: 'text',
                  text: contactText(u.display_name, u.username, window.location.origin),
                  no_preview: true,
                });
                onClose();
              }}
            >
              <span className="font-semibold">{u.display_name}</span>{' '}
              <span className="text-xs opacity-60">@{u.username}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
};
