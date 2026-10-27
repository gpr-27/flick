import { isStandalone } from '@/lib/useBackClose';

/** The OS "reduce motion" request, or the app's own Reduce motion setting. */
export const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.getAttribute('data-motion') === 'reduce') return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
};

/** A phone-sized screen (the sheets and page gestures are phone features). */
export const isPhoneWidth = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 639px)').matches;

export const isIos = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
};

/**
 * iOS Safari in a browser tab has its own edge swipe for Back; a second one would fight it. In
 * the installed app there is none, so ours is the only one.
 */
export const shouldSkipEdgeSwipe = (): boolean => isIos() && !isStandalone();

/** Elements that must keep their own touch behaviour (typing, sliding, drawing, scrolling sideways). */
const OWN_TOUCH =
  'input, textarea, select, canvas, [contenteditable="true"], [role="slider"], [data-no-swipe]';

/** True when `el` (or a parent up to `stopAt`) scrolls sideways and is not at its start. */
export const inSidewaysScroller = (el: Element | null, stopAt: Element | null): boolean => {
  for (let n: Element | null = el; n && n !== stopAt; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && n.scrollLeft > 0) return true;
    }
  }
  return false;
};

/** True when `el` or a parent up to `stopAt` is scrolled down (so a downward drag scrolls it). */
export const inScrolledContent = (el: Element | null, stopAt: Element | null): boolean => {
  for (let n: Element | null = el; n && n !== stopAt; n = n.parentElement) {
    if (n instanceof HTMLElement && n.scrollTop > 0) return true;
  }
  return stopAt instanceof HTMLElement ? stopAt.scrollTop > 0 : false;
};

export const ownsTouch = (el: Element | null): boolean => Boolean(el?.closest(OWN_TOUCH));

export const hasTextSelection = (): boolean => {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
};
