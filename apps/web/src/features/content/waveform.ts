// Waveform: a few dozen loudness bars (0-100) drawn in the bubble before the audio downloads.

export const WAVEFORM_BARS = 48;

/**
 * Reduce raw audio samples (-1..1) to `bars` integers 0-100. Each bar is the loudest sample in its
 * slice, scaled so the loudest bar of the whole clip is 100. Pure, so it is easy to test.
 */
export const reduceSamples = (samples: ArrayLike<number>, bars = WAVEFORM_BARS): number[] => {
  const count = Math.min(bars, samples.length);
  if (count === 0) return [];
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * samples.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / count));
    let peak = 0;
    for (let j = from; j < to; j++) peak = Math.max(peak, Math.abs(samples[j] ?? 0));
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks);
  return peaks.map((p) => (loudest === 0 ? 0 : Math.round((p / loudest) * 100)));
};

/** Decode the recording in the browser and reduce it. Returns [] if the browser cannot decode it. */
export const computeWaveform = async (blob: Blob, bars = WAVEFORM_BARS): Promise<number[]> => {
  try {
    const context = new AudioContext();
    try {
      const audio = await context.decodeAudioData(await blob.arrayBuffer());
      return reduceSamples(audio.getChannelData(0), bars);
    } finally {
      void context.close();
    }
  } catch {
    return [];
  }
};
