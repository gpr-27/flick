// Voice recording. MP4 through MediaRecorder where the browser can; otherwise a plain WAV, so no
// voice note is ever saved in a format an iPhone cannot play (WebM/Opus). The state machine is
// small on purpose:
//   idle -> recording -> (stop) encoding -> idle     |   recording -> (cancel) -> idle
import { useCallback, useEffect, useRef, useState } from 'react';
import { computeWaveform } from '../waveform';
import { startWavRecording, type WavRecorder } from './wav';

export type RecorderState = 'idle' | 'recording' | 'encoding';

export interface Recording {
  blob: Blob;
  mime: string;
  durationMs: number;
  waveform: number[];
}

/**
 * MP4 first. Every phone plays MP4 audio, but a phone cannot reliably play WebM/Opus recorded on
 * a laptop, so a voice note sent from a laptop was silent on the phone.
 */
export const pickMimeType = (): string | undefined =>
  ['audio/mp4', 'audio/webm;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));

/** True when this browser can record MP4. If not, the recorder writes WAV instead of WebM. */
export const canRecordMp4 = (): boolean =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4');

export const useVoiceRecorder = () => {
  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const wav = useRef<WavRecorder | null>(null);
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
    wav.current = null;
  };

  const start = useCallback(async (): Promise<void> => {
    if (state !== 'idle') return;
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      if (!canRecordMp4()) {
        // No MP4 here: write a WAV, which plays everywhere, instead of a WebM that may not.
        wasCancelled.current = false;
        startedAt.current = Date.now();
        wav.current = startWavRecording(stream.current);
        setState('recording');
        return;
      }
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
  const stop = useCallback(async (): Promise<Recording | null> => {
    const wavRecorder = wav.current;
    if (wavRecorder) {
      setState('encoding');
      const durationMs = Math.max(1, Date.now() - startedAt.current);
      const blob = await wavRecorder.stop();
      release();
      if (wasCancelled.current || !blob) {
        setState('idle');
        return null;
      }
      const waveform = await computeWaveform(blob);
      setState('idle');
      return { blob, mime: 'audio/wav', durationMs, waveform };
    }
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return null;
    setState('encoding');
    return new Promise((resolve) => {
      finish.current = resolve;
      rec.stop();
    });
  }, []);

  const cancel = useCallback((): void => {
    const rec = recorder.current;
    wasCancelled.current = true;
    if (wav.current) {
      wav.current.cancel();
      release();
      setState('idle');
      return;
    }
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
      wav.current?.cancel();
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      else release();
    },
    [],
  );

  return { state, error, start, stop, cancel };
};
