import { useEffect, useState } from 'react';
import { Copy, Languages, Pencil, Share2 } from 'lucide-react';
import type { TranscriptData } from '@chat/contracts';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { UI_LANGUAGE } from '@/features/ai/languageDetect';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { useAutoTranslateTarget } from './autoTranslate';
import {
  fetchTranscript,
  saveTranscriptEdit,
  transcribeAttachment,
  translateBatch,
} from './translationApi';

// The transcript of a voice note or video under its player: summary line, text, detected language,
// copy / share / edit, and "Translate" in one step (it transcribes first when there is no transcript).
// It also serves as the captions: when the chat is translated for me the caption is in my language.

const known = new Map<string, TranscriptData>();
/** Attachments the server said have no transcript yet, so a remount does not ask again at once. */
const askedAt = new Map<string, number>();
const RETRY_MS = [8_000, 20_000];

const button = 'flex items-center gap-1 text-xs font-semibold underline disabled:opacity-50';

export const TranscriptView = ({
  attachmentId,
  conversationId,
  compact = false,
  className = '',
}: {
  attachmentId: string;
  conversationId?: string | undefined;
  /** Captions under a video: no editing tools. */
  compact?: boolean;
  className?: string;
}) => {
  const aiEnabled = useAiEnabled();
  const chatLanguage = useAutoTranslateTarget(conversationId ?? '');
  const [transcript, setTranscript] = useState<TranscriptData | null>(
    known.get(attachmentId) ?? null,
  );
  const [busy, setBusy] = useState<'transcribe' | 'translate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);

  const store = (t: TranscriptData | null): void => {
    if (t) known.set(attachmentId, t);
    setTranscript(t);
  };

  // Look for a stored transcript (auto-transcribe may still be working, so ask a couple of times).
  useEffect(() => {
    if (transcript) return;
    let live = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const look = (attempt: number): void => {
      askedAt.set(attachmentId, Date.now());
      fetchTranscript(attachmentId)
        .then((t) => {
          if (!live) return;
          if (t) store(t);
          else if (attempt < RETRY_MS.length) {
            timers.push(setTimeout(() => look(attempt + 1), RETRY_MS[attempt]));
          }
        })
        .catch(() => undefined);
    };
    const last = askedAt.get(attachmentId);
    if (last === undefined || Date.now() - last > (RETRY_MS[0] ?? 8_000)) look(0);
    return () => {
      live = false;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId, transcript === null]);

  const translateTo = chatLanguage ?? UI_LANGUAGE;

  const translate = async (t: TranscriptData): Promise<void> => {
    setBusy('translate');
    try {
      const out = await translateBatch([{ id: 'transcript', text: t.text }], translateTo, false);
      const text = out.get('transcript') ?? null;
      if (!text) throw new Error('empty');
      setTranslated(text);
      setShowTranslated(true);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't translate this."));
    } finally {
      setBusy(null);
    }
  };

  const transcribe = async (thenTranslate: boolean): Promise<void> => {
    setBusy('transcribe');
    setError(null);
    try {
      const text = await transcribeAttachment(attachmentId);
      const stored = await fetchTranscript(attachmentId).catch(() => null);
      const t = stored ?? { text: text || '(No speech found)', language: null, summary: null };
      store(t);
      if (thenTranslate && text) await translate(t);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't transcribe this."));
    } finally {
      setBusy(null);
    }
  };

  // Captions in my language: the chat is translated for me, so the transcript is too.
  useEffect(() => {
    if (!transcript || !chatLanguage || translated !== null || busy) return;
    if (transcript.language && transcript.language === chatLanguage) return;
    // Started from a microtask so the effect itself sets no state.
    void Promise.resolve().then(() => translate(transcript));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript, chatLanguage]);

  const save = async (): Promise<void> => {
    if (editing === null || !editing.trim()) return;
    try {
      const t = await saveTranscriptEdit(attachmentId, editing.trim());
      if (t) store(t);
      setTranslated(null);
      setShowTranslated(false);
      setEditing(null);
    } catch (e) {
      setError(getErrorMessage(e, "Couldn't save the change."));
    }
  };

  const shown = showTranslated && translated ? translated : transcript?.text;
  const copy = (): void => {
    if (!shown) return;
    navigator.clipboard.writeText(shown).then(
      () => notify.success('Copied.'),
      () => notify.error("Couldn't copy."),
    );
  };
  const share = (): void => {
    if (!shown) return;
    if (typeof navigator.share === 'function')
      void navigator.share({ text: shown }).catch(() => undefined);
    else copy();
  };

  if (!transcript) {
    if (aiEnabled === false) return null;
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {!compact && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void transcribe(false)}
              disabled={busy !== null}
              className={button}
            >
              {busy === 'transcribe' ? 'Transcribing...' : 'Transcribe'}
            </button>
            <button
              type="button"
              onClick={() => void transcribe(true)}
              disabled={busy !== null}
              className={button}
            >
              <Languages className="size-3" aria-hidden="true" />
              Translate
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {transcript.summary && (
        <p className="text-sm font-semibold" aria-label="Summary">
          {transcript.summary}
        </p>
      )}
      {editing !== null ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={editing}
            onChange={(e) => {
              setEditing(e.target.value);
            }}
            rows={4}
            aria-label="Edit transcript"
            className="textarea textarea-bordered w-full text-sm text-base-content"
          />
          <div className="flex gap-3">
            <button type="button" className={button} onClick={() => void save()}>
              Save
            </button>
            <button
              type="button"
              className={button}
              onClick={() => {
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p
          className="whitespace-pre-wrap break-words text-sm italic opacity-90"
          aria-label="Transcript"
        >
          {shown}
        </p>
      )}
      {transcript.language && (
        <p className="text-xs opacity-60">
          {showTranslated && translated
            ? `Translated from ${transcript.language}`
            : transcript.language}
        </p>
      )}
      {!compact && editing === null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {translated ? (
            <button
              type="button"
              className={button}
              onClick={() => {
                setShowTranslated((v) => !v);
              }}
            >
              <Languages className="size-3" aria-hidden="true" />
              {showTranslated ? 'Show original' : 'Show translation'}
            </button>
          ) : (
            aiEnabled !== false && (
              <button
                type="button"
                className={button}
                disabled={busy !== null}
                onClick={() => void translate(transcript)}
              >
                <Languages className="size-3" aria-hidden="true" />
                {busy === 'translate' ? 'Translating…' : 'Translate'}
              </button>
            )
          )}
          <button type="button" className={button} onClick={copy}>
            <Copy className="size-3" aria-hidden="true" />
            Copy
          </button>
          <button type="button" className={button} onClick={share}>
            <Share2 className="size-3" aria-hidden="true" />
            Share
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setEditing(transcript.text);
            }}
          >
            <Pencil className="size-3" aria-hidden="true" />
            Edit
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs">
          {error}
        </p>
      )}
    </div>
  );
};
