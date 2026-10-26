import { useEffect, useRef, useState } from 'react';
import type { MessageContent } from '@chat/contracts';
import { Modal } from '@/components/ui';
import { uploadAttachment } from '@/features/chat/upload';
import { MAX_VIDEO_MS, captureFileName, formatTimer, pickVideoMime } from '../camera/capture';

/** Record up to 60 s from the front camera and send it as a round video note. */
export const RoundVideoDialog = ({
  onSend,
  onClose,
}: {
  onSend: (c: MessageContent) => void;
  onClose: () => void;
}) => {
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const cancelled = useRef(false);
  const [phase, setPhase] = useState<'ready' | 'recording' | 'sending'>('ready');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: true })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        stream.current = s;
        if (preview.current) preview.current.srcObject = s;
      })
      .catch(() => {
        setError('Camera or microphone not available. Check the browser permission.');
      });
    return () => {
      alive = false;
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => {
        t.stop();
      });
    };
  }, []);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_VIDEO_MS) recorder.current?.stop();
    }, 250);
    return () => {
      clearInterval(timer);
    };
  }, [phase]);

  const send = async (blob: Blob, durationMs: number): Promise<void> => {
    setPhase('sending');
    try {
      const settings = stream.current?.getVideoTracks()[0]?.getSettings();
      const id = await uploadAttachment(blob, {
        purpose: 'message',
        mime: blob.type,
        fileName: captureFileName('video', blob.type),
      });
      onSend({
        type: 'video',
        attachment_id: id,
        width: settings?.width ?? 480,
        height: settings?.height ?? 480,
        duration_ms: durationMs,
        round: true,
      });
      onClose();
    } catch {
      setError("Couldn't send the video note.");
      setPhase('ready');
    }
  };

  const start = (): void => {
    const s = stream.current;
    const mime = pickVideoMime();
    if (!s || !mime) {
      setError('This browser cannot record video.');
      return;
    }
    const rec = new MediaRecorder(s, { mimeType: mime });
    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      if (cancelled.current) return;
      const type = (rec.mimeType || mime).split(';')[0] ?? 'video/webm';
      void send(new Blob(chunks.current, { type }), Math.max(1, Date.now() - startedAt.current));
    };
    startedAt.current = Date.now();
    rec.start();
    recorder.current = rec;
    setPhase('recording');
  };

  return (
    <Modal open onClose={onClose} label="Video note" className="w-80 p-4 text-center">
      <video
        ref={preview}
        autoPlay
        muted
        playsInline
        className="mx-auto size-56 -scale-x-100 rounded-full bg-black object-cover"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-error">
          {error}
        </p>
      )}
      <p className="mt-2 text-sm tabular-nums">
        {formatTimer(elapsed)} / {formatTimer(MAX_VIDEO_MS)}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        {phase === 'ready' && (
          <button type="button" className="btn btn-primary btn-sm" onClick={start}>
            Record
          </button>
        )}
        {phase === 'recording' && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => recorder.current?.stop()}
          >
            Stop and send
          </button>
        )}
        {phase === 'sending' && <span className="text-sm">Sending…</span>}
      </div>
    </Modal>
  );
};
