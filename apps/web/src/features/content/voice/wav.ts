/* eslint-disable @typescript-eslint/no-deprecated -- ScriptProcessorNode is deprecated but works in
   every browser; its replacement (AudioWorklet) needs a separate script file and does not work in
   some embedded browsers. This runs only as the fallback when MP4 recording is not available. */
// A recorder that makes a plain WAV file. Used when the browser cannot record MP4: its only other
// choice is WebM/Opus, which iPhones often cannot play. WAV plays on every phone and laptop; the
// price is size (16 kHz, 16-bit, mono is about 1.9 MB a minute), which is fine for a voice note.

const TARGET_RATE = 16_000;

/** Average blocks of samples down to TARGET_RATE. Averaging also acts as a simple low-pass filter. */
export function downsample(
  samples: Float32Array,
  fromRate: number,
  toRate = TARGET_RATE,
): Float32Array {
  if (fromRate <= toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ?? 0;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

/** 16-bit little-endian mono PCM in a standard WAV container (44-byte header). */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of this block
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([bytes], { type: 'audio/wav' });
}

export interface WavRecorder {
  /** Stops and returns the WAV file (null if nothing was heard). */
  stop: () => Promise<Blob | null>;
  /** Stops and throws everything away. */
  cancel: () => void;
}

/** Records the microphone stream into a WAV file. */
export function startWavRecording(stream: MediaStream): WavRecorder {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor is old but works in every browser; an AudioWorklet needs a separate file.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let active = true;
  processor.onaudioprocess = (e) => {
    if (active) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination); // required for the processor to run; it outputs silence

  const close = (): void => {
    active = false;
    processor.disconnect();
    source.disconnect();
    void context.close();
  };

  return {
    stop: () => {
      const rate = context.sampleRate;
      close();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (total === 0) return Promise.resolve(null);
      const all = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return Promise.resolve(encodeWav(downsample(all, rate), Math.min(rate, TARGET_RATE)));
    },
    cancel: close,
  };
}
