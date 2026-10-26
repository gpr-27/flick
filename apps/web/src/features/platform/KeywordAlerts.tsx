// Settings > Notifications: words that notify you even in a muted chat, and the people whose
// messages count as priority (the quiet-hours digest reads `priorityContacts`).
import { useState } from 'react';
import { Avatar } from '@/components/ui';
import { useDirectory } from '@/features/directory/useDirectory';
import { useSetting } from '@/features/settings/useSettingsStore';

export const KeywordAlerts = () => {
  const [words, setWords] = useSetting('keywordAlerts');
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const w = draft.trim().toLowerCase();
    if (w && !words.includes(w) && words.length < 20) setWords([...words, w]);
    setDraft('');
  };
  return (
    <div className="py-1">
      <p className="font-semibold">Keyword alerts</p>
      <p className="text-sm text-base-content/60">
        Notify me for these words, even in muted chats.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Your keywords">
        {words.map((w) => (
          <li
            key={w}
            className="flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-sm"
          >
            {w}
            <button
              type="button"
              aria-label={`Remove ${w}`}
              className="min-h-[24px] min-w-[24px]"
              onClick={() => {
                setWords(words.filter((x) => x !== w));
              }}
            >
              x
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="input-soft min-h-[44px] flex-1"
          aria-label="Add a keyword"
          placeholder="Add a keyword"
          maxLength={40}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <button type="submit" className="btn btn-outline min-h-[44px] rounded-2xl">
          Add
        </button>
      </form>
    </div>
  );
};

export const PriorityContacts = () => {
  const [ids, setIds] = useSetting('priorityContacts');
  const [text, setText] = useState('');
  const dir = useDirectory(text);
  const toggle = (id: string): void => {
    setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 50));
  };
  return (
    <div className="py-1">
      <p className="font-semibold">Priority contacts</p>
      <p className="text-sm text-base-content/60">
        {ids.length} selected. Their messages come first in your digest and quiet hours.
      </p>
      <input
        className="input-soft mt-2 min-h-[44px] w-full"
        aria-label="Search people"
        placeholder="Search people"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <ul className="mt-1 max-h-56 overflow-y-auto">
        {dir.items.slice(0, 30).map((u) => (
          <li key={u.id}>
            <label className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={ids.includes(u.id)}
                onChange={() => {
                  toggle(u.id);
                }}
              />
              <Avatar name={u.display_name} src={u.avatar_url} size="sm" />
              <span className="truncate">{u.display_name}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
};
