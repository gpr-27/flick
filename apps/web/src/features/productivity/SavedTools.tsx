import { Markdown } from '@/features/content/richText/Markdown';
import { stripMarkdown } from '@/features/content/richText/stripMarkdown';
import { useEffect, useState } from 'react';
import { Sparkles, Tag } from 'lucide-react';
import { ENDPOINTS, type SavedTag } from '@chat/contracts';
import { Button, notify } from '@/components/ui';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

const TAG_LABELS: Record<SavedTag, string> = {
  note: 'Notes',
  link: 'Links',
  task: 'Tasks',
  idea: 'Ideas',
  receipt: 'Receipts',
};

interface Source {
  message_id: string;
  text: string;
  created_at: string;
}

/**
 * Above the Saved messages chat: ask a question about what you saved, tag saved messages
 * (note, link, task, idea, receipt) and see the ones with a tag. Hidden when AI is off.
 */
export const SavedTools = ({ savedConversationId }: { savedConversationId: string }) => {
  const ai = useAiEnabled();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ text: string; sources: Source[] } | null>(null);
  const [tags, setTags] = useState<{ message_id: string; tag: SavedTag; text?: string }[]>([]);
  const [filter, setFilter] = useState<SavedTag | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    getApi()
      .call(ENDPOINTS.productivity.tags)
      .then(
        (r) => {
          setTags(r.tags);
        },
        () => undefined,
      );
  }, [open, savedConversationId]);

  if (ai === false) return null;

  const ask = async (): Promise<void> => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const r = await getApi().call(ENDPOINTS.productivity.askSaved, {
        body: { question: question.trim() },
      });
      setAnswer({ text: r.answer, sources: r.sources });
    } catch (e) {
      notify.error(getErrorMessage(e, "Flick couldn't answer."));
    } finally {
      setBusy(false);
    }
  };

  const tagAll = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await getApi().call(ENDPOINTS.productivity.tagSaved);
      setTags((cur) => [...cur, ...r.tags]);
      notify.success(r.tags.length ? `Tagged ${r.tags.length} messages` : 'Everything is tagged');
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't tag your messages."));
    } finally {
      setBusy(false);
    }
  };

  const showTag = (tag: SavedTag | null): void => {
    setFilter(tag);
  };

  const shown = filter ? tags.filter((t) => t.tag === filter) : [];

  return (
    <div className="border-b border-base-content/10 px-3 py-2">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-primary-text"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <Sparkles className="size-4" aria-hidden="true" /> Ask Saved messages
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <input
              className="input-soft min-w-0 flex-1 max-sm:text-base"
              placeholder="What did I save about…?"
              aria-label="Ask your saved messages"
              maxLength={500}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
              }}
            />
            <Button variant="primary" type="submit" loading={busy}>
              Ask
            </Button>
          </form>
          {answer && (
            <div className="rounded-xl bg-base-content/5 p-3 text-sm">
              <Markdown text={answer.text} />
              {answer.sources.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-base-content/10 pt-2 text-xs text-base-content/70">
                  {answer.sources.map((s) => (
                    <li key={s.message_id} className="line-clamp-2">
                      “{stripMarkdown(s.text)}”
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(TAG_LABELS) as SavedTag[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn btn-xs ${filter === t ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => showTag(filter === t ? null : t)}
              >
                {TAG_LABELS[t]} {tags.filter((x) => x.tag === t).length || ''}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-xs btn-outline"
              disabled={busy}
              onClick={() => void tagAll()}
            >
              <Tag className="size-3" aria-hidden="true" /> Tag with Flick
            </button>
          </div>
          {filter && (
            <ul className="flex flex-col gap-1 text-sm">
              {shown.length === 0 && (
                <li className="text-base-content/60">Nothing with this tag yet.</li>
              )}
              {shown.map((t) => (
                <li
                  key={t.message_id}
                  className="line-clamp-2 rounded-lg bg-base-content/5 px-2 py-1"
                >
                  {t.text || 'Saved message'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
