import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { FlickTopic } from '@chat/contracts';
import { notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useFlickTopics } from './useFlickTopics';

/** "New topic" line in the Flick chat; the title can be renamed in place. */
export const TopicDivider = ({ topic }: { topic: FlickTopic }) => {
  const rename = useFlickTopics((s) => s.rename);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const next = title.trim();
    if (!next || next === topic.title) {
      setEditing(false);
      return;
    }
    try {
      await rename(topic.id, next);
      setEditing(false);
    } catch (err) {
      notify.error(getErrorMessage(err, "Couldn't rename the topic."));
    }
  };

  return (
    <div
      data-topic-id={topic.id}
      className="my-3 flex items-center gap-3 px-4 text-xs text-base-content/60"
    >
      <span className="h-px flex-1 bg-base-content/10" aria-hidden="true" />
      {editing ? (
        <form onSubmit={(e) => void save(e)} className="flex items-center gap-1">
          <input
            value={title}
            maxLength={80}
            autoFocus
            aria-label="Topic title"
            className="input-soft h-8 min-w-0 px-2 text-xs"
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
          <button type="submit" className="btn btn-primary btn-xs">
            Save
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="flex items-center gap-1 rounded-full bg-sunken px-3 py-1 font-medium text-primary-text"
          aria-label={`Topic: ${stripMarkdown(topic.title)}. Rename`}
          onClick={() => {
            setTitle(topic.title);
            setEditing(true);
          }}
        >
          {stripMarkdown(topic.title)}
          <Pencil className="size-3" aria-hidden="true" />
        </button>
      )}
      <span className="h-px flex-1 bg-base-content/10" aria-hidden="true" />
    </div>
  );
};
