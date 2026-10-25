/** A light tap on phones that can buzz (not iPhone Safari, which has no vibrate). Safe anywhere. */
export const haptic = (ms = 10): void => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
};
