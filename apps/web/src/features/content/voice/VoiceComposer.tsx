import { useEffect, useState } from 'react';
import { Eye, Mic, Send, Trash2 } from 'lucide-react';
import type { MessageContent } from '@chat/contracts';
import { Spinner, cn } from '@/components/ui';
import { uploadAttachment } from '@/features/chat/upload';
import { formatClock } from '../format';
import { useVoiceRecorder, type Recording } from './useVoiceRecorder';

export type VoiceContent = Extract<MessageContent, { type: 'voice' }>;

/** A mic button; while recording, a bar covers the composer with timer, cancel and send. */
export const VoiceComposer = ({
  disabled,
  onSend,
  buttonClassName,
}: {
  disabled: boolean;
  onSend: (content: VoiceContent) => void;
  /** Extra classes for the mic button. */
  buttonClassName?: string | undefined;
}) => {
  const { state, error, start, stop, cancel } = useVoiceRecorder();
  const [elapsed, setElapsed] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  const [pending, setPending] = useState<Recording | null>(null);
  const [upload, setUpload] = useState<'idle' | 'uploading' | 'failed'>('idle');

  useEffect(() => {
    if (state !== 'recording') return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [state]);

  const send = async (recording: Recording): Promise<void> => {
    setPending(recording);
    setUpload('uploading');
    try {
      const attachmentId = await uploadAttachment(recording.blob, {
        purpose: 'message',
        mime: recording.mime,
        fileName: `voice.${recording.mime === 'audio/mp4' ? 'm4a' : 'webm'}`,
      });
      onSend({
        type: 'voice',
        attachment_id: attachmentId,
        duration_ms: recording.durationMs,
        // The contract needs at least one sample; a single bar is drawn as a plain bar.
        waveform: recording.waveform.length > 0 ? recording.waveform : [50],
        ...(viewOnce ? { view_once: true } : {}),
      });
      setPending(null);
      setUpload('idle');
      setViewOnce(false);
    } catch {
      setUpload('failed');
    }
  };

  const stopAndSend = async (): Promise<void> => {
    const recording = await stop();
    if (recording) await send(recording);
  };

  const discard = (): void => {
    setPending(null);
    setUpload('idle');
  };

  const active = state !== 'idle' || pending !== null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setElapsed(0);
          void start();
        }}
        disabled={disabled || active}
        className={cn(
          'btn btn-circle btn-ghost btn-sm text-base-content/60 max-sm:order-1 max-sm:min-h-11 max-sm:min-w-11',
          buttonClassName,
        )}
        aria-label="Record voice message"
      >
        <Mic className="size-5" aria-hidden="true" />
      </button>
      {error && (
        <p role="alert" className="sr-only">
          {error}
        </p>
      )}
      {active && (
        <div
          role="group"
          aria-label="Voice message"
          className="glass absolute inset-0 z-20 flex items-center gap-3 px-4"
        >
          {upload === 'idle' ? (
            <>
              <button
                type="button"
                onClick={cancel}
                className="btn btn-circle btn-ghost btn-sm"
                aria-label="Cancel recording"
              >
                <Trash2 className="size-5" aria-hidden="true" />
              </button>
              <span className="size-2.5 animate-pulse rounded-full bg-error" aria-hidden="true" />
              <span role="timer" aria-label="Recording time" className="font-mono text-sm">
                {formatClock(elapsed)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setViewOnce((v) => !v);
                }}
                aria-pressed={viewOnce}
                className={cn('btn btn-ghost btn-sm gap-1', viewOnce && 'text-primary')}
              >
                <Eye className="size-4" aria-hidden="true" />
                View once
              </button>
              <button
                type="button"
                onClick={() => void stopAndSend()}
                disabled={state !== 'recording'}
                className="btn-grad grid size-11 place-items-center rounded-full"
                aria-label="Send voice message"
              >
                <Send className="size-5" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              {upload === 'uploading' ? (
                <>
                  <Spinner size="sm" label="Uploading voice message" />
                  <span className="text-sm">Sending voice message…</span>
                </>
              ) : (
                <>
                  <span role="alert" className="text-sm font-semibold text-error">
                    Voice message not sent
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (pending) void send(pending);
                    }}
                  >
                    Retry
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={discard}>
                    Discard
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};
