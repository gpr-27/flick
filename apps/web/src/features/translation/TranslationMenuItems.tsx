import { useEffect, useState } from 'react';
import { notify } from '@/components/ui/notify';
import { getErrorMessage } from '@/lib/api';
import { UI_LANGUAGE } from '@/features/ai/languageDetect';
import { useAiEnabled } from '@/features/ai/useAiEnabled';
import { setAutoTranslateTarget, useAutoTranslateTarget } from './autoTranslate';
import { getChatTranscribe, setChatTranscribe } from './translationApi';

const itemClass =
  'w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-base-200 focus-visible:bg-base-200 focus-visible:outline-none max-sm:min-h-[44px]';

/**
 * Chat menu items: transcribe voice notes on arrival, and translate this chat into my language.
 * Both are my own setting for this chat (in a group every reader picks theirs).
 */
export const TranslationMenuItems = ({
  conversationId,
  onDone,
}: {
  conversationId: string;
  onDone: () => void;
}) => {
  const aiEnabled = useAiEnabled();
  const [transcribe, setTranscribe] = useState(false);
  const translateTo = useAutoTranslateTarget(conversationId);

  useEffect(() => {
    let live = true;
    getChatTranscribe(conversationId)
      .then((v) => live && setTranscribe(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversationId]);

  if (aiEnabled === false) return null;

  const run = (job: Promise<unknown>, message: string): void => {
    onDone();
    job.then(
      () => notify.success(message),
      (e: unknown) => notify.error(getErrorMessage(e, "Couldn't change this.")),
    );
  };

  return (
    <>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          const next = !transcribe;
          setTranscribe(next);
          run(
            setChatTranscribe(conversationId, next),
            next ? 'Voice notes in this chat will be transcribed.' : 'Auto-transcribe is off.',
          );
        }}
      >
        {transcribe ? 'Auto-transcribe voice notes: turn off' : 'Auto-transcribe voice notes'}
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          const next = translateTo ? null : UI_LANGUAGE;
          run(
            setAutoTranslateTarget(conversationId, next),
            next ? `This chat is translated to ${next}.` : 'Auto-translate is off.',
          );
        }}
      >
        {translateTo ? `Auto-translate (${translateTo}): turn off` : 'Auto-translate this chat'}
      </button>
    </>
  );
};
