import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  loadSavedReplies,
  saveSavedReplies,
  upsertReply,
} from '@/features/chat/slash/savedReplies';

/** Saved replies: type "/omw" in a chat to use one. */
export const SavedRepliesEditor = () => {
  const [list, setList] = useState(loadSavedReplies);
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');

  const update = (next: typeof list): void => {
    setList(next);
    saveSavedReplies(next);
  };
  const add = (): void => {
    const next = upsertReply(list, shortcut, text);
    if (!next) return;
    update(next);
    setShortcut('');
    setText('');
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <p className="text-sm font-semibold">Saved replies</p>
      <p className="text-xs text-base-content/60">
        Type the shortcut after a slash in a chat, for example /omw.
      </p>
      {list.map((r) => (
        <div key={r.shortcut} className="flex items-center gap-2 text-sm">
          <span className="font-semibold">/{r.shortcut}</span>
          <span className="min-w-0 flex-1 truncate text-base-content/70">{r.text}</span>
          <button
            type="button"
            aria-label={`Delete /${r.shortcut}`}
            className="flex size-11 items-center justify-center"
            onClick={() => {
              update(list.filter((x) => x.shortcut !== r.shortcut));
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          aria-label="Shortcut"
          placeholder="omw"
          value={shortcut}
          onChange={(e) => {
            setShortcut(e.target.value);
          }}
          className="input input-bordered min-h-[44px] w-24"
        />
        <input
          aria-label="Reply text"
          placeholder="On my way!"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className="input input-bordered min-h-[44px] min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={add}
          aria-label="Add saved reply"
          className="btn btn-primary min-h-[44px]"
        >
          Add
        </button>
      </div>
    </div>
  );
};
