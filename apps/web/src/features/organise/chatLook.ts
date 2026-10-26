// Per-chat look and sound: an accent colour for your bubbles and a notification sound. Kept on this
// device (localStorage), one entry per conversation.
import { useSyncExternalStore, type CSSProperties } from 'react';
import { playMessageSound } from '../notifications/sound';

export type ChatSound = 'default' | 'chime' | 'pop' | 'none';
export interface ChatLook {
  accent?: string; // #rrggbb
  sound?: ChatSound;
}

export const ACCENTS = [
  '#7c3aed',
  '#2563eb',
  '#0d9488',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#db2777',
] as const;
export const SOUNDS: { value: ChatSound; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'chime', label: 'Chime' },
  { value: 'pop', label: 'Pop' },
  { value: 'none', label: 'Silent' },
];

const KEY = 'flick.chatLook';
export const isHexColor = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Reads the stored map, dropping anything malformed. */
export const parseLooks = (raw: string | null): Record<string, ChatLook> => {
  try {
    const data: unknown = JSON.parse(raw ?? '{}');
    if (typeof data !== 'object' || data === null) return {};
    const out: Record<string, ChatLook> = {};
    for (const [id, v] of Object.entries(data)) {
      const look = v as ChatLook;
      out[id] = {
        ...(isHexColor(look.accent) ? { accent: look.accent } : {}),
        ...(SOUNDS.some((s) => s.value === look.sound) ? { sound: look.sound } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
};

let looks = ((): Record<string, ChatLook> => {
  try {
    return parseLooks(localStorage.getItem(KEY));
  } catch {
    return {};
  }
})();
const listeners = new Set<() => void>();

export const getChatLook = (id: string): ChatLook => looks[id] ?? EMPTY;
const EMPTY: ChatLook = {};

export const setChatLook = (id: string, look: ChatLook): void => {
  looks = { ...looks, [id]: look };
  try {
    localStorage.setItem(KEY, JSON.stringify(looks));
  } catch {
    /* not kept */
  }
  listeners.forEach((l) => {
    l();
  });
};

export const useChatLook = (id: string): ChatLook =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => getChatLook(id),
  );

const tone = (ctx: AudioContext, freq: number, at: number, volume: number, len: number): void => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.25 * volume), at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + len + 0.02);
};

/** Plays the chosen sound for a chat ('default' is the app-wide ping). */
export const playChatSound = (sound: ChatSound, volume: number): void => {
  if (sound === 'none') return;
  if (sound === 'default') {
    playMessageSound(volume);
    return;
  }
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    if (sound === 'chime') {
      tone(ctx, 1319, t, volume, 0.35);
      tone(ctx, 1760, t + 0.15, volume, 0.45);
    } else tone(ctx, 440, t, volume, 0.12);
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* blocked until the user interacts */
  }
};

/** Message sound for an incoming message in this chat. */
export const playIncomingFor = (conversationId: string, volume: number): void => {
  playChatSound(getChatLook(conversationId).sound ?? 'default', volume);
};

/** Inline style that recolours the sent bubbles inside a chat (they read these CSS variables). */
export const accentStyle = (accent: string | undefined): CSSProperties | undefined =>
  accent
    ? ({ '--bubble-sent-bg': accent, '--bubble-sent-image': 'none' } as CSSProperties)
    : undefined;
