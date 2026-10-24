import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { UserSummary } from '@chat/contracts';
import { Button, Input, Modal } from '@/components/ui';
import { useChatStore } from '../useChatStore';
import { UserSearch } from './UserSearch';

const panel = 'glass-card mx-4 w-full max-w-md rounded-3xl p-6 animate-scale-in';

const Header = ({ id, title, onClose }: { id: string; title: string; onClose: () => void }) => (
  <div className="mb-4 flex items-center justify-between">
    <h2 id={id} className="font-display text-xl font-bold">
      {title}
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
);

/** "New chat": find a person and open (or create) the direct conversation with them. */
export const NewChatModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const openDirect = useChatStore((s) => s.openDirect);
  return (
    <Modal open={open} onClose={onClose} labelledBy="new-chat-title" className={panel}>
      <Header id="new-chat-title" title="New chat" onClose={onClose} />
      <UserSearch
        actionLabel={(u) => `Chat with ${u.display_name}`}
        onPick={(user) => {
          void openDirect(user.id).then(onClose);
        }}
      />
    </Modal>
  );
};

/** "New group": a title and the people to start with. */
export const NewGroupModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const createGroup = useChatStore((s) => s.createGroup);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    void createGroup(
      title.trim(),
      picked.map((u) => u.id),
    ).then((ok) => {
      setBusy(false);
      if (ok) {
        setTitle('');
        setPicked([]);
        onClose();
      }
    });
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="new-group-title" className={panel}>
      <Header id="new-group-title" title="New group" onClose={onClose} />
      <form onSubmit={submit} className="space-y-4">
        <Input
          label="Group name"
          placeholder="Group name"
          value={title}
          maxLength={100}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        {picked.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Selected members">
            {picked.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="chip gap-1"
                  aria-label={`Remove ${u.display_name}`}
                  onClick={() => {
                    setPicked((list) => list.filter((x) => x.id !== u.id));
                  }}
                >
                  {u.display_name} <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <UserSearch
          excludeIds={picked.map((u) => u.id)}
          actionLabel={(u) => `Add ${u.display_name}`}
          buttonText="Add"
          disabledLabel="Added"
          onPick={(user) => {
            setPicked((list) => [...list, user]);
          }}
        />
        <Button type="submit" variant="gradient" size="lg" loading={busy} disabled={!title.trim()}>
          Create group
        </Button>
      </form>
    </Modal>
  );
};
