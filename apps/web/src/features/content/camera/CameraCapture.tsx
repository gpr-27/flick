import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, RefreshCw, Send, Square, SwitchCamera, Video, X } from 'lucide-react';
import { Modal, cn } from '@/components/ui';
import { hasMediaSupport, mediaErrorMessage } from '@/features/calls/media';
import { MAX_VIDEO_MS, captureFileName, formatTimer, pickVideoMime, takePhoto } from './capture';

type Mode = 'photo' | 'video';
type Facing = 'user' | 'environment';

interface Taken {
  file: File;
  url: string;
}

/**
 * Take a photo or record a video with the camera, right inside the chat. After the shot you
 * can retake or use it; "use" hands the file to the normal attachment flow (caption, send).
 * Photo mode never asks for the microphone; video mode does. `photoOnly` hides video mode and
 * starts on the front camera (a profile photo).
 */
export const CameraCapture = ({
  open,
  onClose,
  onCapture,
  photoOnly = false,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  photoOnly?: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<Facing>(photoOnly ? 'user' : 'environment');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [taken, setTaken] = useState<Taken | null>(null);
  const canRecord = !photoOnly && pickVideoMime() !== undefined;
  const message =
    error ??
    (hasMediaSupport()
      ? null
      : 'This browser cannot open the camera here. Use the photo picker instead.');

  const stopStream = useCallback((): void => {
    stream.current?.getTracks().forEach((t) => {
      t.stop();
    });
    stream.current = null;
    setReady(false);
  }, []);

  const stopTimer = (): void => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  // Open (or re-open on a mode or camera change) the camera while the sheet is showing a live view.
  useEffect(() => {
    if (!open || taken) return;
    if (!hasMediaSupport()) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        stream.current = s;
        setError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(mediaErrorMessage(e));
      });
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, mode, facing, taken, stopStream]);

  // Closing the sheet (by any route) frees the camera and forgets a shot nobody used.
  const close = (): void => {
    stopTimer();
    recorder.current = null;
    setRecording(false);
    setElapsed(0);
    setError(null);
    if (taken) URL.revokeObjectURL(taken.url);
    setTaken(null);
    onClose();
  };

  useEffect(() => () => stopTimer(), []);

  const shoot = async (): Promise<void> => {
    if (!videoRef.current) return;
    const file = await takePhoto(videoRef.current);
    if (file) setTaken({ file, url: URL.createObjectURL(file) });
    else setError('The camera has no picture yet. Try again in a moment.');
  };

  const startRecording = (): void => {
    const s = stream.current;
    const mime = pickVideoMime();
    if (!s || !mime) return;
    chunks.current = [];
    const rec = new MediaRecorder(s, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const type = mime.split(';')[0] ?? 'video/webm';
      const file = new File(chunks.current, captureFileName('video', type), { type });
      if (file.size > 0) setTaken({ file, url: URL.createObjectURL(file) });
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
    setElapsed(0);
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_VIDEO_MS) stopRecording();
    }, 250);
  };

  function stopRecording(): void {
    stopTimer();
    setRecording(false);
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  const retake = (): void => {
    if (taken) URL.revokeObjectURL(taken.url);
    setTaken(null);
    setElapsed(0);
  };

  const use = (): void => {
    if (!taken) return;
    URL.revokeObjectURL(taken.url);
    onCapture(taken.file);
    setTaken(null);
    stopTimer();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      label="Camera"
      overlayClassName="items-stretch p-0 sm:items-center sm:p-4"
      className="h-dvh w-full sm:h-auto sm:max-w-2xl"
    >
      <div className="relative flex h-full flex-col overflow-hidden bg-black text-white sm:rounded-3xl">
        <button
          type="button"
          onClick={close}
          className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 grid size-11 place-items-center rounded-full bg-black/50"
          aria-label="Close camera"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <div className="relative flex min-h-0 flex-1 items-center justify-center sm:aspect-video sm:flex-none">
          {taken ? (
            taken.file.type.startsWith('video/') ? (
              <video
                src={taken.url}
                controls
                playsInline
                className="h-full w-full object-contain"
                aria-label="Your video"
              />
            ) : (
              <img src={taken.url} alt="Your photo" className="h-full w-full object-contain" />
            )
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Camera preview"
              className={cn('h-full w-full object-cover', facing === 'user' && 'scale-x-[-1]')}
            />
          )}

          {message && (
            <div
              role="alert"
              className="absolute inset-0 grid place-items-center bg-black/80 p-6 text-center"
            >
              <div className="flex max-w-sm flex-col items-center gap-4">
                <p>{message}</p>
                <button type="button" className="btn btn-primary" onClick={close}>
                  Close
                </button>
              </div>
            </div>
          )}

          {recording && (
            <span className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-sm font-semibold tabular-nums">
              <Circle className="size-2.5 animate-pulse fill-current" aria-hidden="true" />
              <span role="timer">{formatTimer(elapsed)}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 bg-black/90 px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {taken ? (
            <div className="flex w-full max-w-sm gap-3">
              <button type="button" onClick={retake} className="btn h-12 flex-1 gap-2">
                <RefreshCw className="size-4" aria-hidden="true" /> Retake
              </button>
              <button type="button" onClick={use} className="btn btn-primary h-12 flex-1 gap-2">
                <Send className="size-4" aria-hidden="true" /> Use{' '}
                {taken.file.type.startsWith('video/') ? 'video' : 'photo'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-8">
                {canRecord ? (
                  <div
                    className="flex rounded-full bg-white/10 p-1 text-sm"
                    role="tablist"
                    aria-label="Camera mode"
                  >
                    {(['photo', 'video'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        disabled={recording}
                        onClick={() => {
                          setMode(m);
                        }}
                        className={cn(
                          'flex h-10 items-center gap-1.5 rounded-full px-4',
                          mode === m && 'bg-white text-black',
                        )}
                      >
                        {m === 'photo' ? (
                          <Camera className="size-4" aria-hidden="true" />
                        ) : (
                          <Video className="size-4" aria-hidden="true" />
                        )}
                        {m === 'photo' ? 'Photo' : 'Video'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-10">
                <span className="size-12" aria-hidden="true" />
                {mode === 'photo' ? (
                  <button
                    type="button"
                    onClick={() => void shoot()}
                    disabled={!ready}
                    className="grid size-[72px] place-items-center rounded-full border-4 border-white bg-white/20 active:scale-95 disabled:opacity-40"
                    aria-label="Take photo"
                  >
                    <span className="size-14 rounded-full bg-white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={recording ? stopRecording : startRecording}
                    disabled={!ready}
                    className="grid size-[72px] place-items-center rounded-full border-4 border-white bg-white/20 active:scale-95 disabled:opacity-40"
                    aria-label={recording ? 'Stop recording' : 'Start recording'}
                  >
                    {recording ? (
                      <Square className="size-7 fill-red-600 text-red-600" aria-hidden="true" />
                    ) : (
                      <span className="size-14 rounded-full bg-red-600" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
                  }}
                  disabled={recording}
                  className="grid size-12 place-items-center rounded-full bg-white/10 disabled:opacity-40"
                  aria-label="Switch camera"
                >
                  <SwitchCamera className="size-5" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
