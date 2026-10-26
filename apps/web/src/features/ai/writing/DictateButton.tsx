import { useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { notify, cn } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { useVoiceRecorder } from '@/features/content/voice/useVoiceRecorder';
import { dictate } from './writingApi';

const MAX_MS = 120_000;

/** Dictate then clean up: record, send to /ai/dictate (speech to text, fillers removed), insert. */
export const DictateButton = ({
  disabled,
  onText,
  className,
}: {
  disabled?: boolean;
  onText: (text: string) => void;
  className?: string;
}) => {
  const recorder = useVoiceRecorder();
  const [working, setWorking] = useState(false);
  const recording = recorder.state === 'recording';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    const rec = await recorder.stop();
    if (!rec) return;
    setWorking(true);
    try {
      const text = await dictate(rec.blob, rec.mime);
      if (text) onText(text);
      else notify.info('Flick did not hear anything.');
    } catch (e) {
      notify.error(getErrorMessage(e, 'Could not turn that into text.'));
    } finally {
      setWorking(false);
    }
  };

  const toggle = (): void => {
    if (recording) {
      void finish();
      return;
    }
    void recorder.start().then(() => {
      // A forgotten recording stops itself.
      timer.current = setTimeout(() => {
        void finish();
      }, MAX_MS);
    });
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled || working || recorder.state === 'encoding'}
        aria-pressed={recording}
        onClick={toggle}
        className={cn(
          'chip shrink-0 cursor-pointer gap-1 whitespace-nowrap max-sm:min-h-[36px]',
          recording && '!bg-error !text-error-content',
          className,
        )}
      >
        {recording ? (
          <Square className="size-3.5" aria-hidden="true" />
        ) : (
          <Mic className="size-3.5" aria-hidden="true" />
        )}
        {recording ? 'Stop' : working ? 'Writing…' : 'Dictate'}
      </button>
      {recorder.error && (
        <span role="alert" className="text-xs text-error">
          {recorder.error}
        </span>
      )}
    </>
  );
};
