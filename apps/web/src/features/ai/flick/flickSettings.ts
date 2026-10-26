import { useCallback, useEffect, useState } from 'react';

// Per-device switches for talking to Flick. Kept in localStorage; a failure just means "default".

const read = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};

/** A boolean setting in localStorage, shared between tabs and components via a window event. */
const useFlag = (key: string, fallback: boolean): [boolean, (v: boolean) => void] => {
  const [value, setValue] = useState(() => read(key, fallback));
  useEffect(() => {
    const sync = (): void => {
      setValue(read(key, fallback));
    };
    window.addEventListener('flick-setting', sync);
    return () => {
      window.removeEventListener('flick-setting', sync);
    };
  }, [key, fallback]);
  const set = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? '1' : '0');
      } catch {
        /* private mode: the switch just won't be remembered */
      }
      setValue(v);
      window.dispatchEvent(new Event('flick-setting'));
    },
    [key],
  );
  return [value, set];
};

/** Speak Flick's replies with the browser voice. Off by default. */
export const useReadAloud = () => useFlag('flick.readAloud', false);
/** Show 3 follow-up suggestions under the latest reply. Off by default (each set costs one AI call). */
export const useFollowupSetting = () => useFlag('flick.followups', false);

/** Browser text-to-speech (no network). */
export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Plain text for speaking: no markdown marks, code or links. */
export const speakableText = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const speak = (text: string): void => {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const clean = speakableText(text);
  if (clean) window.speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
};

export const stopSpeaking = (): void => {
  if (canSpeak()) window.speechSynthesis.cancel();
};
