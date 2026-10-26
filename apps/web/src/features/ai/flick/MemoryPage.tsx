import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import type { FlickMemory } from '@chat/contracts';
import { Spinner, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { ToggleRow } from '@/features/settings/components/controls';
import { addMemory, clearMemories, deleteMemory, listMemories, updateMemory } from './flickApi';
import { useFollowupSetting } from './flickSettings';

/** What Flick remembers about you: add, edit and delete each fact, or forget everything. */
const MemoryPage = () => {
  const [memories, setMemories] = useState<FlickMemory[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState('');
  const [followups, setFollowups] = useFollowupSetting();

  useEffect(() => {
    listMemories().then(setMemories, (e: unknown) => {
      setMemories([]);
      notify.error(getErrorMessage(e, "Couldn't load your memories."));
    });
  }, []);

  const save = async (e: FormEvent, id: string): Promise<void> => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      const updated = await updateMemory(id, text.trim());
      setMemories((l) => l?.map((m) => (m.id === id ? updated : m)) ?? null);
      setEditing(null);
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't save that."));
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await deleteMemory(id);
      setMemories((l) => l?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't delete that."));
    }
  };

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!fresh.trim()) return;
    try {
      const created = await addMemory(fresh.trim());
      setMemories((l) => [created, ...(l ?? []).filter((m) => m.id !== created.id)]);
      setFresh('');
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't remember that."));
    }
  };

  const forgetAll = async (): Promise<void> => {
    if (!window.confirm('Forget everything Flick remembers about you?')) return;
    try {
      await clearMemories();
      setMemories([]);
      notify.success('Flick forgot everything.');
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't forget everything."));
    }
  };

  return (
    <main className="mx-auto w-full max-w-xl overflow-y-auto p-4">
      <header className="mb-4 flex items-center gap-2">
        <Link to="/" className="btn btn-ghost btn-circle btn-sm" aria-label="Back to chats">
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="font-display text-xl font-semibold">What Flick remembers</h1>
      </header>
      <p className="mb-4 text-sm text-base-content/70">
        Tell Flick “remember that …” in your chat with it, or add a fact here. Flick uses these to
        answer you better. Nothing here is shared with anyone.
      </p>

      <form onSubmit={(e) => void add(e)} className="mb-4 flex gap-2">
        <input
          className="input-soft min-h-[44px] min-w-0 flex-1"
          placeholder="Add something to remember"
          aria-label="New memory"
          maxLength={300}
          value={fresh}
          onChange={(e) => {
            setFresh(e.target.value);
          }}
        />
        <button
          type="submit"
          className="btn btn-primary min-h-[44px] rounded-2xl"
          disabled={!fresh.trim()}
        >
          Add
        </button>
      </form>

      {memories === null ? (
        <div className="flex justify-center py-8">
          <Spinner size="sm" label="Loading memories" />
        </div>
      ) : memories.length === 0 ? (
        <p className="rounded-2xl bg-sunken p-4 text-center text-sm text-base-content/70">
          Flick has not remembered anything yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2">
              {editing === m.id ? (
                <form onSubmit={(e) => void save(e, m.id)} className="flex min-w-0 flex-1 gap-2">
                  <input
                    className="input-soft min-w-0 flex-1"
                    aria-label="Edit memory"
                    maxLength={300}
                    autoFocus
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                    }}
                  />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm">{m.fact}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle"
                    aria-label={`Edit: ${m.fact}`}
                    onClick={() => {
                      setText(m.fact);
                      setEditing(m.id);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-circle text-error"
                    aria-label={`Delete: ${m.fact}`}
                    onClick={() => void remove(m.id)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {memories && memories.length > 0 && (
        <button
          type="button"
          className="btn btn-outline btn-error mt-4 rounded-2xl"
          onClick={() => void forgetAll()}
        >
          Forget everything
        </button>
      )}

      <div className="mt-6">
        <ToggleRow
          label="Follow-up suggestions"
          hint="Show three short ideas for what to ask next, under Flick's latest answer."
          checked={followups}
          onChange={setFollowups}
        />
      </div>
    </main>
  );
};

export default MemoryPage;
