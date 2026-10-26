// Voice note trimming: pure range maths plus a decode/slice/encode step that writes a WAV.
import { computeWaveform } from '../waveform';
import { encodeWav } from './wav';
import type { Recording } from './useVoiceRecorder';

export interface TrimRange {
  start: number; // 0..1
  end: number; // 0..1
}

/** Keeps the handles inside 0..1 and at least `minGap` apart. */
export const clampRange = (r: TrimRange, minGap = 0.05): TrimRange => {
  const start = Math.min(Math.max(0, r.start), 1 - minGap);
  const end = Math.max(Math.min(1, r.end), start + minGap);
  return { start, end };
};

export const isFullRange = (r: TrimRange): boolean => r.start <= 0.001 && r.end >= 0.999;

/** The waveform bars that fall inside the range. */
export const sliceWaveform = (bars: readonly number[], r: TrimRange): number[] => {
  const from = Math.floor(r.start * bars.length);
  const to = Math.max(from + 1, Math.ceil(r.end * bars.length));
  return bars.slice(from, to);
};

/** A new recording with only the chosen part (decoded in the browser, saved as WAV). */
export async function trimRecording(rec: Recording, r: TrimRange): Promise<Recording> {
  if (isFullRange(r)) return rec;
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const part = data.slice(Math.floor(r.start * data.length), Math.ceil(r.end * data.length));
    const blob = encodeWav(part, audio.sampleRate);
    return {
      blob,
      mime: 'audio/wav',
      durationMs: Math.max(1, Math.round((part.length / audio.sampleRate) * 1000)),
      waveform: await computeWaveform(blob),
    };
  } finally {
    void ctx.close();
  }
}
