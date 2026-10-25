import { Modal, Spinner } from '@/components/ui';
import { translateText } from './aiApi';
import { useAiEnabled } from './useAiEnabled';
import { LANGUAGES } from './languages';
import { ModelTag } from './ModelTag';
import { useAiTask } from './useAiTask';

/** "Translate" for one message: pick a language, read the result. Opened from the message menu. */
export const TranslateDialog = ({
  text,
  open,
  onClose,
}: {
  text: string;
  open: boolean;
  onClose: () => void;
}) => {
  const enabled = useAiEnabled();
  const task = useAiTask();

  const translate = (language: string): void => {
    if (!language) return;
    void task.run(async ({ onModel }) => {
      const answer = await translateText(text, language);
      onModel(answer.model);
      return answer.text;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Translate message"
      overlayClassName="max-sm:items-end sm:p-4"
      className="w-full sm:w-80"
    >
      <div className="glass-card flex flex-col gap-3 rounded-t-3xl border border-base-content/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm shadow-2xl sm:rounded-2xl">
        {enabled === false ? (
          <p role="status">AI is not set up on this server.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Translate to
              <select
                className="select select-bordered h-12 text-base font-normal"
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
              <>
                <p className="whitespace-pre-wrap break-words">{task.state.text}</p>
                <ModelTag label={task.state.model} />
              </>
            )}
            {task.state.status === 'error' && (
              <p role="alert" className="text-error">
                {task.state.notConfigured ? 'AI is not set up on this server.' : task.state.error}
              </p>
            )}
          </>
        )}
        <button type="button" className="btn btn-ghost h-12" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};
