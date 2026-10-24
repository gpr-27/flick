// Voice recording with MediaRecorder. The state machine is small on purpose:
//   idle -> recording -> (stop) encoding -> idle     |   recording -> (cancel) -> idle
import { useCallback, useEffect, useRef, useState } from 'react';
import { computeWaveform } from '../waveform';

export type RecorderState = 'idle' | 'recording' | 'encoding';

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
  waveform: number[];
}

/** Chrome and Firefox record webm/opus, Safari only mp4. */
export const pickMimeType = (): string | undefined =>
  ['audio/webm;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));

export const useVoiceRecorder = () => {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const wasCancelled = useRef(false);
  const finish = useRef<((r: Recording | null) => void) | null>(null);

  const release = (): void => {
    stream.current?.getTracks().forEach((t) => {
      t.stop();
    });
    stream.current = null;
    recorder.current = null;
  };

  const start = useCallback(async (): Promise<void> => {
    if (state !== 'idle') return;
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      wasCancelled.current = false;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const done = finish.current;
        finish.current = null;
        // The upload allow list wants the plain type, without ";codecs=opus".
        const mime = (rec.mimeType || mimeType || 'audio/webm').split(';')[0] ?? 'audio/webm';
        const blob = new Blob(chunks.current, { type: mime });
        const durationMs = Math.max(1, Date.now() - startedAt.current);
        release();
        if (wasCancelled.current || blob.size === 0) {
          setState('idle');
          done?.(null);
          return;
        }
        void computeWaveform(blob).then((waveform) => {
          setState('idle');
          done?.({ blob, mime, durationMs, waveform });
        });
      };
      startedAt.current = Date.now();
      rec.start();
      recorder.current = rec;
      setState('recording');
    } catch {
      release();
      setError('Microphone not available. Check the browser permission.');
      setState('idle');
    }
  }, [state]);

  /** Stop and get the recording (null if nothing was recorded). */
  const stop = useCallback((): Promise<Recording | null> => {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    setState('encoding');
    return new Promise((resolve) => {
      finish.current = resolve;
      rec.stop();
    });
  }, []);

  const cancel = useCallback((): void => {
    const rec = recorder.current;
    wasCancelled.current = true;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      release();
      setState('idle');
    }
  }, []);

  // Leaving the chat mid-recording throws the recording away and frees the microphone.
  useEffect(
    () => () => {
      wasCancelled.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      else release();
    },
    [],
  );

  return { state, error, start, stop, cancel };
};
