import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Modal } from '@/components/ui';
import { TAG_COLORS, useChatLists } from './useChatLists';

/** Put a chat in folders and give it coloured tags. New folders and tags are made here too. */
export const ChatListsDialog = ({
  conversationId,
  open,
  onClose,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const { lists, load, create, toggle, remove } = useChatLists();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'folder' | 'tag'>('folder');
  const [color, setColor] = useState(TAG_COLORS[3]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim()) return;
    void create(kind, name.trim(), kind === 'tag' ? color : undefined);
    setName('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="lists-title"
      className="glass-card mx-4 flex max-h-[80vh] w-full max-w-sm flex-col rounded-3xl p-6 animate-scale-in"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 id="lists-title" className="font-display text-xl font-bold">
          Folders and tags
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
      <ul className="scroll-slim mb-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {lists.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-xl px-2 py-1 hover:bg-base-content/5">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={l.conversation_ids.includes(conversationId)}
                onChange={() => {
                  void toggle(l, conversationId);
                }}
              />
              {l.kind === 'tag' && (
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: l.color ?? '#888' }}
                />
              )}
              <span className="flex-1 truncate">{l.name}</span>
              <span className="text-xs text-base-content/50">{l.kind}</span>
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-label={`Delete ${l.name}`}
              onClick={() => {
                void remove(l.id);
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {lists.length === 0 && (
          <li className="text-sm text-base-content/60">Nothing yet. Make one below.</li>
        )}
      </ul>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-2">
          <select
            aria-label="Kind"
            className="select select-bordered select-sm"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === 'tag' ? 'tag' : 'folder');
            }}
          >
            <option value="folder">Folder</option>
            <option value="tag">Tag</option>
          </select>
          <input
            aria-label="Name"
            className="input-soft min-w-0 flex-1"
            placeholder="Work, Family..."
            maxLength={30}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Add
          </button>
        </div>
        {kind === 'tag' && (
          <div className="flex gap-2" role="radiogroup" aria-label="Colour">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => {
                  setColor(c);
                }}
                className={`size-6 rounded-full ${color === c ? 'ring-2 ring-offset-2' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}
      </form>
    </Modal>
  );
};
