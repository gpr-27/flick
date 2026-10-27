import { useEffect, useRef, type RefObject } from 'react';
import {
  SETTLE_MS,
  isSheetSwipeDismiss,
  lockAxis,
  settleTransition,
  sheetOffset,
  velocity,
  type Axis,
} from './navGestureMath';
import {
  hasTextSelection,
  inScrolledContent,
  isPhoneWidth,
  ownsTouch,
  prefersReducedMotion,
} from './env';

/**
 * Swipe a phone sheet/dialog down to close it. Touch only, passive listeners, the panel is moved
 * with a transform straight on the element (no React re-render per frame). It stays out of the way
 * of scrolling: a drag only counts when the panel (and whatever inside it) is scrolled to the top,
 * the finger goes mostly down, and the touch did not start on a field, slider or `data-no-swipe`.
 * `panelRef` is the element that moves; `onClose` runs once the panel has slid away.
 */
export const useSwipeDismiss = (
  panelRef: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: (() => void) | undefined,
): void => {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel || !onClose) return;

    let start: { x: number; y: number; t: number } | null = null;
    let axis: Axis = 'undecided';
    let dy = 0;
    let last = { y: 0, t: 0 };
    let vy = 0;
    let timer: number | undefined;

    const clear = (): void => {
      panel.style.translate = '';
      panel.style.transition = '';
      panel.style.willChange = '';
    };
    const settle = (): void => {
      if (prefersReducedMotion()) {
        clear();
        return;
      }
      panel.style.transition = settleTransition(false, 'translate');
      panel.style.translate = '0 0';
      timer = window.setTimeout(clear, SETTLE_MS + 20);
    };

    const onStart = (e: TouchEvent): void => {
      start = null;
      axis = 'undecided';
      dy = 0;
      const touch = e.touches[0];
      if (e.touches.length !== 1 || !touch || !isPhoneWidth()) return;
      const target = e.target instanceof Element ? e.target : null;
      if (ownsTouch(target) || inScrolledContent(target, panel) || hasTextSelection()) return;
      window.clearTimeout(timer);
      start = { x: touch.clientX, y: touch.clientY, t: e.timeStamp };
      last = { y: touch.clientY, t: e.timeStamp };
      vy = 0;
    };

    const onMove = (e: TouchEvent): void => {
      const touch = e.touches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const rawDy = touch.clientY - start.y;
      if (axis === 'undecided') {
        axis = lockAxis(dx, rawDy);
        // Only a downward, mostly vertical drag is ours; anything else is left to the browser.
        if (axis === 'horizontal' || (axis === 'vertical' && rawDy <= 0)) start = null;
        if (!start) return;
        if (axis === 'undecided') return;
        panel.style.willChange = 'translate';
        panel.style.transition = 'none';
      }
      dy = sheetOffset(rawDy);
      vy = velocity(touch.clientY - last.y, e.timeStamp - last.t);
      last = { y: touch.clientY, t: e.timeStamp };
      if (!prefersReducedMotion()) panel.style.translate = `0 ${String(dy)}px`;
    };

    const onEnd = (): void => {
      const was = start;
      start = null;
      if (!was || axis !== 'vertical') {
        axis = 'undecided';
        return;
      }
      axis = 'undecided';
      if (isSheetSwipeDismiss(dy, vy)) {
        if (prefersReducedMotion()) {
          clear();
          closeRef.current?.();
          return;
        }
        panel.style.transition = settleTransition(false, 'translate');
        panel.style.translate = '0 100%';
        timer = window.setTimeout(() => {
          closeRef.current?.();
          // The owner may keep it open (a confirm step): bring the panel back.
          timer = window.setTimeout(() => {
            if (panel.isConnected) settle();
          }, 80);
        }, SETTLE_MS);
      } else {
        settle();
      }
    };

    const onCancel = (): void => {
      if (start && axis === 'vertical') settle();
      start = null;
      axis = 'undecided';
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: true });
    panel.addEventListener('touchend', onEnd, { passive: true });
    panel.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.clearTimeout(timer);
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onCancel);
      clear();
    };
    // onClose presence matters (no handler, no gesture); its identity does not.
  }, [active, panelRef, Boolean(onClose)]); // eslint-disable-line react-hooks/exhaustive-deps
};
