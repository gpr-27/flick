// A short two-note "ping" made with the Web Audio API, so there is no audio file to ship.
// Browsers only allow audio after the user has interacted with the page once, which is always
// true for a signed-in chat; if it is blocked we simply stay silent.
import { canPlaySound } from './rules';

let lastPlayedAt: number | null = null;
let context: AudioContext | null = null;

/** `volume` is 0 to 1 (the slider in Settings). */
const note = (ctx: AudioContext, frequency: number, start: number, volume: number): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volume), start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + 0.2);
};

const ping = (volume: number): boolean => {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    note(context, 880, context.currentTime, volume);
    note(context, 1175, context.currentTime + 0.12, volume);
    return true;
  } catch {
    return false;
  }
};

/** Plays the ping unless one played less than a second ago. Returns whether it played. */
export const playMessageSound = (volume: number, now: number = Date.now()): boolean => {
  if (!canPlaySound(lastPlayedAt, now)) return false;
  lastPlayedAt = now;
  return ping(volume);
};

/** The "Test" button in Settings: always plays. */
export const playTestSound = (volume: number): boolean => ping(volume);
