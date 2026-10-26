import { useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { Spinner, cn, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { uploadAttachment } from '@/features/chat/upload';
import { useVoiceRecorder } from '@/features/content/voice/useVoiceRecorder';
import { transcribeAttachment } from './flickApi';

/** Recordings shorter than this are a slip of the finger, not a question. */
const MIN_MS = 500;

/**
 * Hold to talk: the recording is transcribed and the words are sent as a normal text message
 * (so Flick answers it like any other).
 */
export const HoldToTalk = ({ onText }: { onText: (text: string) => void }) => {
  const { state, error, start, stop, cancel } = useVoiceRecorder();
  const [busy, setBusy] = useState(false);
  const holding = useRef(false);
  const isHolding = (): boolean => holding.current;

  const begin = async (): Promise<void> => {
    holding.current = true;
    await start();
    if (!isHolding()) cancel(); // let go before the microphone was ready
  };

  const end = async (): Promise<void> => {
    if (!holding.current) return;
    holding.current = false;
    const recording = await stop();
    if (!recording) return;
    if (recording.durationMs < MIN_MS) {
      notify.info('Hold the button while you speak.');
      return;
    }
    setBusy(true);
    try {
      const id = await uploadAttachment(recording.blob, {
        purpose: 'message',
        mime: recording.mime,
        fileName: `voice.${recording.mime === 'audio/mp4' ? 'm4a' : recording.mime === 'audio/wav' ? 'wav' : 'webm'}`,
      });
      const text = (await transcribeAttachment(id)).trim();
      if (text) onText(text);
      else notify.info("I couldn't hear anything. Try again.");
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't understand the recording."));
    } finally {
      setBusy(false);
    }
  };

  const recording = state === 'recording';
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={recording ? 'Release to send' : 'Hold to talk to Flick'}
        title="Hold to talk"
        className={cn(
          'flex min-h-[36px] touch-none select-none items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
          recording ? 'animate-pulse bg-error text-error-content' : 'bg-sunken text-primary-text',
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          void begin();
        }}
        onPointerUp={() => void end()}
        onPointerCancel={() => {
          holding.current = false;
          cancel();
        }}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            void begin();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') void end();
        }}
      >
        {busy ? (
          <Spinner size="sm" label="Understanding" />
        ) : (
          <Mic className="size-4" aria-hidden="true" />
        )}
        {busy ? 'Listening…' : recording ? 'Release to send' : 'Hold to talk'}
      </button>
      {error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
    </>
  );
};
