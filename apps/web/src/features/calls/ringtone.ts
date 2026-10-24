// The sound of an incoming call: two short tones, a pause, repeat. Made with the Web Audio API
// (no audio file). Settings > Notifications can turn it off and set the volume.

const PERIOD_MS = 2_000;

export interface RingtoneOptions {
  enabled: boolean;
  /** 0 to 1. */
  volume: number;
}

const tone = (ctx: AudioContext, frequency: number, start: number, volume: number): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * volume), start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.4);
};

/** Starts ringing and returns the function that stops it. Does nothing when it is switched off. */
export const startRingtone = ({ enabled, volume }: RingtoneOptions): (() => void) => {
  if (!enabled || volume <= 0) return () => undefined;
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => undefined; // no audio in this browser
  }
  const ring = (): void => {
    // Blocked until the person has touched the page; then we just stay silent.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    tone(ctx, 740, now, volume);
    tone(ctx, 988, now + 0.45, volume);
  };
  ring();
  const timer = setInterval(ring, PERIOD_MS);
  return () => {
    clearInterval(timer);
    void ctx.close().catch(() => undefined);
  };
};
