import { useState } from 'react';
import { Languages } from 'lucide-react';
import { translateText } from './aiApi';
import { foreignLanguage, UI_LANGUAGE } from './languageDetect';
import { useAiEnabled } from './useAiEnabled';
import { useAiTask } from './useAiTask';

/** A small "Translate" chip under an incoming message written in another language. */
export const TranslateChip = ({ text }: { text: string }) => {
  const enabled = useAiEnabled();
  const task = useAiTask();
  const [shown, setShown] = useState(false);
  const language = foreignLanguage(text);
  if (!language || enabled !== true) return null;

  if (shown && task.state.status === 'done') {
    return (
      <p className="mt-1 whitespace-pre-wrap break-words border-t border-base-content/10 pt-1 text-sm italic">
        {task.state.text}
      </p>
    );
  }
  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={task.state.status === 'loading'}
        onClick={() => {
          setShown(true);
          void task.run(
            async ({ signal }) => (await translateText(text, UI_LANGUAGE, signal)).text,
          );
        }}
        className="chip h-6 cursor-pointer gap-1 text-xs"
      >
        <Languages className="size-3" aria-hidden="true" />
        {task.state.status === 'loading' ? 'Translating…' : `Translate from ${language}`}
      </button>
      {task.state.status === 'error' && (
        <span role="alert" className="ml-2 text-xs text-error">
          {task.state.error}
        </span>
      )}
    </div>
  );
};
