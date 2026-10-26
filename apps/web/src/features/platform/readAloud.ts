// "Read aloud" with the browser's speech synthesis. No server, no download.
export const canReadAloud = (): boolean =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined';

export const isReading = (): boolean => canReadAloud() && window.speechSynthesis.speaking;

export const stopReading = (): void => {
  if (canReadAloud()) window.speechSynthesis.cancel();
};

/** Starts reading `text`; reading again while speaking stops instead. */
export const toggleReadAloud = (text: string): void => {
  if (!canReadAloud()) return;
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utterance.lang = document.documentElement.lang || navigator.language;
  window.speechSynthesis.speak(utterance);
};
