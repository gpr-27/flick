// Call sounds, made with the browser's Web Audio API so there is no audio file to download.
//   ring      the person being called hears this (two tones, the classic phone ring)
//   ringback  the caller hears this while waiting for an answer (one soft tone, slower)
// Both repeat until stopped. A browser only lets a page play sound after the person has touched
// the page once; in a chat app that has always happened by the time a call comes in.

export type Tone = 'ring' | 'ringback';

interface Beep {
  /** Frequencies played together (Hz). */
  freqs: number[];
  /** Seconds the beep lasts. */
  seconds: number;
}

// One cycle of each sound: beeps and the silence after each one (seconds).
const PATTERNS: Record<Tone, { beeps: Beep[]; gaps: number[]; pause: number; volume: number }> = {
  ring: {
    beeps: [
      { freqs: [440, 480], seconds: 0.4 },
      { freqs: [440, 480], seconds: 0.4 },
    ],
    gaps: [0.2, 0.2],
    pause: 2,
    volume: 0.18,
  },
  ringback: {
    beeps: [{ freqs: [425], seconds: 1 }],
    gaps: [0],
    pause: 3,
    volume: 0.08,
  },
};

// Vibration on phones: buzz, pause, buzz. Only for the person being called.
const VIBRATION_MS = [400, 200, 400, 2000];

let context: AudioContext | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let current: Tone | null = null;

const audioContext = (): AudioContext | null => {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  return context;
};

function playCycle(ctx: AudioContext, tone: Tone): number {
  const { beeps, gaps, pause, volume } = PATTERNS[tone];
  let at = ctx.currentTime + 0.05;
  beeps.forEach((beep, i) => {
    const gain = ctx.createGain();
    // A short fade in and out, so the beep does not click.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.03);
    gain.gain.setValueAtTime(volume, at + beep.seconds - 0.05);
    gain.gain.linearRampToValueAtTime(0, at + beep.seconds);
    gain.connect(ctx.destination);
    for (const freq of beep.freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + beep.seconds);
    }
    at += beep.seconds + (gaps[i] ?? 0);
  });
  return (at - ctx.currentTime + pause) * 1000;
}

/** Starts the sound and repeats it until stopRingtone(). Starting the same tone again does nothing. */
export function startRingtone(tone: Tone): void {
  if (current === tone) return;
  stopRingtone();
  const ctx = audioContext();
  if (!ctx) return;
  current = tone;
  void ctx.resume().catch(() => undefined);

  const loop = (): void => {
    if (current !== tone) return;
    const waitMs = playCycle(ctx, tone);
    timer = setTimeout(loop, waitMs);
  };
  loop();

  if (tone === 'ring' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(VIBRATION_MS);
  }
}

export function stopRingtone(): void {
  current = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (typeof navigator.vibrate === 'function') navigator.vibrate(0);
}
