import { useState } from 'react';
import { composeText } from './aiApi';

export interface ToneResult {
  /** True when the message reads fine. */
  ok: boolean;
  note?: string;
  softer?: string;
}

/** Reads the model's "OK" or "NOTE: ... SOFTER: ..." answer. Anything unclear counts as fine. */
export function parseToneAnswer(answer: string): ToneResult {
  const text = answer.trim();
  const note = /NOTE:\s*([\s\S]*?)(?:\n\s*SOFTER:|$)/i.exec(text)?.[1]?.trim();
  const softer = /SOFTER:\s*([\s\S]*)$/i.exec(text)?.[1]?.trim();
  if (!note || !softer) return { ok: true };
  return { ok: false, note, softer };
}

export const checkTone = async (text: string, signal?: AbortSignal): Promise<ToneResult> =>
  parseToneAnswer((await composeText({ mode: 'tone', text }, signal)).text);

const KEY = 'flick.toneCheck';

/** The "Check tone before sending" switch in Settings. A per-device preference. */
export const readToneSetting = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const useToneSetting = (): [boolean, (on: boolean) => void] => {
  const [on, setOn] = useState(readToneSetting);
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // storage blocked: the switch just will not be remembered
      }
    },
  ];
};
