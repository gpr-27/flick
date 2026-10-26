// "Play next voice note automatically": when one ends, the next unplayed one in the chat starts.
const KEY = 'flick.voiceAutoNext';

export const autoNextEnabled = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
};
export const setAutoNext = (on: boolean): void => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* not kept */
  }
};

/** Index of the first not-yet-played note after `from`, or -1. */
export const nextUnplayed = (played: readonly boolean[], from: number): number => {
  for (let i = from + 1; i < played.length; i++) if (!played[i]) return i;
  return -1;
};

/** Called when `ended` finishes: starts the next unplayed voice note below it in the page. */
export const playNextAfter = (ended: HTMLAudioElement): void => {
  if (!autoNextEnabled()) return;
  const all = Array.from(document.querySelectorAll<HTMLAudioElement>('audio[data-voice]'));
  const i = nextUnplayed(
    all.map((a) => a.dataset.played === '1'),
    all.indexOf(ended),
  );
  if (i >= 0) void all[i]?.play().catch(() => undefined);
};
