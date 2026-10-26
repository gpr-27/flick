import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { Card, ToggleRow } from '@/features/settings/components/controls';
import { getTranslationSettings, updateTranslationSettings } from './translationApi';

/** Settings: transcribe voice notes everywhere, and words that translation must leave alone. */
export const TranslationSettings = () => {
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let live = true;
    getTranslationSettings()
      .then((s) => {
        if (!live) return;
        setAutoTranscribe(s.auto_transcribe);
        setWords(s.dont_translate);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const save = (body: { auto_transcribe?: boolean; dont_translate?: string[] }): void => {
    updateTranslationSettings(body).then(
      (s) => {
        setAutoTranscribe(s.auto_transcribe);
        setWords(s.dont_translate);
      },
      (e: unknown) => notify.error(getErrorMessage(e, "Couldn't save this.")),
    );
  };

  const add = (e: FormEvent): void => {
    e.preventDefault();
    const word = draft.trim();
    if (!word || words.includes(word)) return;
    setDraft('');
    save({ dont_translate: [...words, word] });
  };

  return (
    <Card title="Transcripts and translation">
      <ToggleRow
        label="Transcribe voice notes automatically"
        hint="Voice notes and audio files up to 25 MB get a transcript when they arrive, in every chat."
        checked={autoTranscribe}
        onChange={(v) => {
          setAutoTranscribe(v);
          save({ auto_transcribe: v });
        }}
      />
      <div className="pt-2">
        <p className="font-medium">Never translate these words</p>
        <p className="text-sm text-[var(--text-2)]">Names and brands stay as they are.</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {words.map((w) => (
            <li
              key={w}
              className="flex items-center gap-1 rounded-full bg-[var(--bg-active)] px-3 py-1 text-sm"
            >
              {w}
              <button
                type="button"
                aria-label={`Remove ${w}`}
                onClick={() => {
                  save({ dont_translate: words.filter((x) => x !== w) });
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            maxLength={60}
            aria-label="Word to keep untranslated"
            placeholder="Add a name or word"
            className="input input-bordered input-sm min-h-[44px] flex-1"
          />
          <button type="submit" className="btn btn-sm min-h-[44px]">
            Add
          </button>
        </form>
      </div>
    </Card>
  );
};
