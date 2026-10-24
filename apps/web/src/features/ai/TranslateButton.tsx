import { Languages } from 'lucide-react';
import { Spinner, cn } from '@/components/ui';
import { translateText } from './aiApi';
import { useAiEnabled } from './useAiEnabled';
import { LANGUAGES } from './languages';
import { useAiTask } from './useAiTask';

/**
 * "Translate" action for one message: a button plus a small popover where you pick the
 * language and read the result. `open` is owned by the bubble so the hover toolbar stays visible.
 */
export const TranslateButton = ({
  text,
  open,
  onOpenChange,
  align,
}: {
  text: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  align: 'left' | 'right';
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();

  const translate = (language: string): void => {
    if (!language) return;
    void task.run(async () => translateText(text, language));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onOpenChange(!open);
        }}
        className="hover:text-primary focus-visible:text-primary"
        aria-label="Translate message"
        aria-expanded={open}
      >
        <Languages className="size-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Translate message"
          className={cn(
            'glass-card absolute bottom-full z-20 mb-1 flex w-64 flex-col gap-2 rounded-xl border border-base-content/10 p-3 text-sm shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {enabled === false ? (
            <p role="status">AI is not set up on this server.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs font-semibold">
                Translate to
                <select
                  className="select select-bordered select-sm font-normal"
                  defaultValue=""
                  disabled={task.state.status === 'loading'}
                  onChange={(e) => {
                    translate(e.target.value);
                  }}
                >
                  <option value="" disabled>
                    Choose a language
                  </option>
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>
              {task.state.status === 'loading' && <Spinner size="sm" label="Translating" />}
              {task.state.status === 'done' && (
                <p className="whitespace-pre-wrap break-words">{task.state.text}</p>
              )}
              {task.state.status === 'error' && (
                <p role="alert" className="text-error">
                  {task.state.notConfigured ? 'AI is not set up on this server.' : task.state.error}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};
