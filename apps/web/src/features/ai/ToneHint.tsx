import { useEffect, useState } from 'react';
import { HeartHandshake } from 'lucide-react';
import { Markdown } from '@/features/content/richText/Markdown';
import { checkTone, readToneSetting, type ToneResult } from './toneCheck';
import { useAiEnabled } from './useAiEnabled';

const PAUSE_MS = 2_500;
const MIN_CHARS = 12;

/**
 * When "Check tone before sending" is on: a moment after you stop typing, a small note appears
 * if the message may sound harsh, with a softer version to use. It never blocks sending.
 */
export const ToneHint = ({ text, onUse }: { text: string; onUse: (softer: string) => void }) => {
  const enabled = useAiEnabled();
  const [result, setResult] = useState<(ToneResult & { for: string }) | null>(null);
  const active = enabled === true && readToneSetting();

  useEffect(() => {
    const draft = text.trim();
    if (!active || draft.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkTone(draft, controller.signal)
        .then((r) => {
          setResult({ ...r, for: text });
        })
        .catch(() => {
          // non-blocking: a failed check is silent
        });
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, text]);

  if (!active || !result || result.ok || result.for !== text) return null;
  return (
    <div
      role="status"
      className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs"
    >
      <HeartHandshake className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {result.note && <Markdown text={result.note} />}
        {result.softer && (
          <Markdown
            text={`Calmer: ${result.softer}`}
            className="mt-0.5 italic text-[var(--text-2)]"
          />
        )}
      </div>
      <button
        type="button"
        className="font-semibold underline"
        onClick={() => {
          onUse(result.softer ?? text);
          setResult(null);
        }}
      >
        Use calmer version
      </button>
      <button
        type="button"
        className="underline"
        onClick={() => {
          setResult(null);
        }}
      >
        Keep mine
      </button>
    </div>
  );
};
