import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SETTLE_MS,
  backSwipeOffset,
  canStartBackSwipe,
  isBackSwipeCommit,
  lockAxis,
  settleTransition,
  velocity,
  type Axis,
} from '@/lib/gestures/navGestureMath';
import {
  hasTextSelection,
  inSidewaysScroller,
  isPhoneWidth,
  ownsTouch,
  prefersReducedMotion,
  shouldSkipEdgeSwipe,
} from '@/lib/gestures/env';
import { goBack } from '@/lib/gestures/goBack';
import { useChatStore } from '@/features/chat/useChatStore';

/** Dialogs, menus and viewers handle Back themselves; the page must not slide under them. */
const OVERLAY_SELECTOR =
  '[aria-modal="true"], [role="menu"], [role="dialog"], [data-no-edge-swipe]';

/**
 * Swipe in from the left edge to go back, on phone-sized screens, on page-like screens (an open
 * chat, or any page other than the chat list). The page follows the finger; letting go past a
 * third of the screen, or with a quick flick, goes back. Touch only, passive listeners. Skipped
 * where the browser has its own edge swipe (iOS Safari in a tab).
 */
export const EdgeSwipeBack = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const chatOpen = useChatStore((s) => s.selectedId !== null);
  const enabled = pathname !== '/' || chatOpen;
  const navRef = useRef(navigate);
  useEffect(() => {
    navRef.current = navigate;
  });

  useEffect(() => {
    if (!enabled || shouldSkipEdgeSwipe()) return;
    let start: { x: number; y: number; t: number } | null = null;
    let axis: Axis = 'undecided';
    let dx = 0;
    let vx = 0;
    let last = { x: 0, t: 0 };
    let page: HTMLElement | null = null;
    let timer: number | undefined;

    const reset = (): void => {
      if (page) {
        page.style.translate = '';
        page.style.transition = '';
        page.style.willChange = '';
      }
      page = null;
    };

    const onStart = (e: TouchEvent): void => {
      start = null;
      axis = 'undecided';
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || !isPhoneWidth()) return;
      if (!canStartBackSwipe(t.clientX, true)) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OVERLAY_SELECTOR) || document.querySelector(OVERLAY_SELECTOR)) return;
      if (ownsTouch(target) || inSidewaysScroller(target, null) || hasTextSelection()) return;
      window.clearTimeout(timer);
      reset();
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp };
      last = { x: t.clientX, t: e.timeStamp };
      dx = 0;
      vx = 0;
    };

    const onMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (!start || !t) return;
      const rawDx = t.clientX - start.x;
      if (axis === 'undecided') {
        axis = lockAxis(rawDx, t.clientY - start.y);
        if (axis === 'undecided') return;
        if (axis === 'vertical' || rawDx <= 0) {
          start = null;
          return;
        }
        page = document.getElementById('main');
        if (page && !prefersReducedMotion()) {
          page.style.willChange = 'translate';
          page.style.transition = 'none';
        }
      }
      dx = backSwipeOffset(rawDx, window.innerWidth);
      vx = velocity(t.clientX - last.x, e.timeStamp - last.t);
      last = { x: t.clientX, t: e.timeStamp };
      if (page && !prefersReducedMotion()) page.style.translate = `${String(dx)}px 0`;
    };

    const onEnd = (): void => {
      const was = start;
      start = null;
      if (!was || axis !== 'horizontal') {
        axis = 'undecided';
        return;
      }
      axis = 'undecided';
      const go = (): void => {
        reset();
        goBack((to, o) => {
          navRef.current(to, o);
        });
      };
      if (!isBackSwipeCommit(dx, vx, window.innerWidth)) {
        if (page && !prefersReducedMotion()) {
          page.style.transition = settleTransition(false, 'translate');
          page.style.translate = '0 0';
          timer = window.setTimeout(reset, SETTLE_MS + 20);
        } else reset();
      } else if (page && !prefersReducedMotion()) {
        page.style.transition = settleTransition(false, 'translate');
        page.style.translate = `${String(window.innerWidth)}px 0`;
        timer = window.setTimeout(go, SETTLE_MS);
      } else go();
    };

    const onCancel = (): void => {
      if (start && axis === 'horizontal' && page) {
        page.style.transition = settleTransition(false, 'translate');
        page.style.translate = '0 0';
        timer = window.setTimeout(reset, SETTLE_MS + 20);
      }
      start = null;
      axis = 'undecided';
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      reset();
    };
  }, [enabled]);

  return null;
};
