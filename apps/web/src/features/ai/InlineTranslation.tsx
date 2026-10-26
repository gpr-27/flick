import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { translateText } from './aiApi';
import { UI_LANGUAGE } from './languageDetect';
import { translationCache } from './translationCache';

/**
 * The translation shown under a message after "Translate" in its menu, with "Show original" to
 * hide it again. Mounted only while shown.
 */
export const InlineTranslation = ({
  messageId,
  text,
  onHide,
}: {
  messageId: string;
  text: string;
  onHide: () => void;
}) => {
  const [translated, setTranslated] = useState<string | null>(
    translationCache.get(messageId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (translationCache.has(messageId)) return;
    const controller = new AbortController();
    translateText(text, UI_LANGUAGE, controller.signal)
      .then((answer) => {
        translationCache.set(messageId, answer.text);
        setTranslated(answer.text);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(getErrorMessage(e, "Couldn't translate."));
      });
    return () => {
      controller.abort();
    };
  }, [messageId, text]);

  return (
    <div className="mt-1 border-t border-base-content/10 pt-1 text-sm">
      {translated !== null ? (
        <p className="whitespace-pre-wrap break-words italic">{translated}</p>
      ) : error ? (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : (
        <p role="status" className="text-xs opacity-70">
          Translating…
        </p>
      )}
      <button
        type="button"
        onClick={onHide}
        className="mt-1 flex items-center gap-1 text-xs font-semibold underline"
      >
        <Languages className="size-3" aria-hidden="true" />
        Show original
      </button>
    </div>
  );
};
