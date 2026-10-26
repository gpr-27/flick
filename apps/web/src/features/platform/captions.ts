// Live captions in calls. Your own microphone is turned into text by the browser's speech
// recognition (Web Speech API: Chrome, Edge and Safari; not Firefox) and the text is sent to the
// other side over the call's data channel (LiveKit in group calls, an RTCDataChannel in 1:1
// calls). Each side shows the other's words as subtitles. Nothing goes through the Flick server.
import { create } from 'zustand';

const PREFIX = 'cc:';

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

const recognitionCtor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const captionsSupported = (): boolean => recognitionCtor() !== undefined;

let sender: ((text: string) => void) | null = null;
let recognition: RecognitionLike | null = null;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** The call tells us how to send a line to the other side (null when the call ends). */
export const setCaptionSender = (fn: ((text: string) => void) | null): void => {
  sender = fn;
  if (!fn) useCaptions.getState().setEnabled(false);
};

/** A data message from the other side; returns true when it was a caption (not a reaction). */
export const handleCaptionMessage = (raw: string): boolean => {
  if (!raw.startsWith(PREFIX)) return false;
  useCaptions.getState().receive(raw.slice(PREFIX.length));
  return true;
};

interface CaptionState {
  enabled: boolean;
  /** What the other person is saying. */
  theirs: string;
  /** Language to translate their words into ("" = off). Needs the AI service. */
  translateTo: string;
  setEnabled: (on: boolean) => void;
  setTranslateTo: (lang: string) => void;
  receive: (text: string) => void;
}

export const useCaptions = create<CaptionState>()((set, get) => ({
  enabled: false,
  theirs: '',
  translateTo: '',
  setTranslateTo: (translateTo) => {
    set({ translateTo });
  },
  receive: (text) => {
    const show = (t: string): void => {
      set({ theirs: t });
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        set({ theirs: '' });
      }, 6000);
    };
    show(text);
    const lang = get().translateTo;
    if (lang) {
      void import('@/features/ai/aiApi')
        .then((m) => m.translateText(text, lang))
        .then((r) => {
          if (get().theirs === text) show(r.text);
        })
        .catch(() => undefined);
    }
  },
  setEnabled: (on) => {
    if (on === get().enabled) return;
    if (!on) {
      const r = recognition;
      recognition = null;
      if (r) {
        r.onend = null;
        r.stop();
      }
      set({ enabled: false, theirs: '' });
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false; // whole phrases: less traffic, no flicker
    r.lang = document.documentElement.lang || navigator.language;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res?.[0]?.transcript.trim();
        if (res?.isFinal && text) sender?.(PREFIX + text);
      }
    };
    // The browser ends recognition after silence; start it again while captions are on.
    r.onend = () => {
      if (recognition === r) {
        try {
          r.start();
        } catch {
          // already running
        }
      }
    };
    r.onerror = () => undefined;
    recognition = r;
    try {
      r.start();
    } catch {
      recognition = null;
      return;
    }
    set({ enabled: true });
  },
}));
