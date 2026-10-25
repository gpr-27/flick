// Pointer handling for one swipeable chat row (touch, pen and mouse use the same events).
// The decisions live in swipeGesture.ts; this file only connects them to the DOM.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  classifyIntent,
  dragOffset,
  resolveRelease,
  restOffsetFor,
  tapAction,
  type Intent,
  type Side,
} from './swipeGesture';
import { useOpenRow } from './useOpenRow';

/** True when the person (or their system) asked for less motion. */
export const prefersReducedMotion = (): boolean =>
  document.documentElement.getAttribute('data-motion') === 'reduce' ||
  (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

interface Options {
  id: string;
  rowRef: RefObject<HTMLElement | null>;
  /** Swiping is switched off (select mode, or a locked-down row). */
  disabled?: boolean;
  /** A long swipe ended: run the first action of that side. */
  onTrigger: (side: Side) => void;
}

interface Tracking {
  x: number;
  y: number;
  pointerId: number;
  rest: number;
  intent: Intent;
}

export const useSwipeRow = ({ id, rowRef, disabled = false, onTrigger }: Options) => {
  const openId = useOpenRow((s) => s.openId);
  const openSide = useOpenRow((s) => s.side);
  const open: Side | null = openId === id ? openSide : null;
  // The card follows the finger while dragging; otherwise it rests where the store says.
  const [drag, setDrag] = useState<number | null>(null);
  const tracking = useRef<Tracking | null>(null);
  // A swipe ends with a "click" on the card; it must not open the chat.
  const swallowClick = useRef(false);
  const latestTrigger = useRef(onTrigger);
  useEffect(() => {
    latestTrigger.current = onTrigger;
  });

  const width = (): number => rowRef.current?.offsetWidth || 360;

  // Tapping anywhere else, or pressing Escape, closes an open row.
  useEffect(() => {
    if (!open) return;
    const away = (e: globalThis.PointerEvent): void => {
      if (!rowRef.current?.contains(e.target as Node)) useOpenRow.getState().close();
    };
    const escape = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') useOpenRow.getState().close();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open, rowRef]);

  const stop = useCallback(() => {
    tracking.current = null;
    setDrag(null);
  }, []);

  const finish = (e: PointerEvent, cancelled: boolean): void => {
    const t = tracking.current;
    if (!t) return;
    const wasSwipe = t.intent === 'horizontal';
    tracking.current = null;
    try {
      e.currentTarget.releasePointerCapture(t.pointerId);
    } catch {
      // Not captured (or not supported): nothing to release.
    }
    if (!wasSwipe) return;
    swallowClick.current = true;
    const offset = dragOffset(t.rest, e.clientX - t.x, width());
    setDrag(null);
    if (cancelled) {
      // The browser took the touch (for example to scroll): put the row back where it was.
      return;
    }
    const release = resolveRelease(offset, width());
    if (release.kind === 'trigger') {
      useOpenRow.getState().close();
      if ('vibrate' in navigator) navigator.vibrate(10);
      latestTrigger.current(release.side);
    } else if (release.kind === 'open') {
      useOpenRow.getState().open(id, release.side);
    } else {
      useOpenRow.getState().close();
    }
  };

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      // Another row that is open closes as soon as a new gesture starts elsewhere.
      if (useOpenRow.getState().openId !== id) useOpenRow.getState().close();
      swallowClick.current = false;
      tracking.current = {
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        rest: restOffsetFor(open),
        intent: 'pending',
      };
    },
    onPointerMove: (e: PointerEvent) => {
      const t = tracking.current;
      if (!t || t.pointerId !== e.pointerId) return;
      const dx = e.clientX - t.x;
      if (t.intent === 'pending') {
        t.intent = classifyIntent(dx, e.clientY - t.y);
        if (t.intent === 'vertical') {
          tracking.current = null; // a scroll: leave it to the browser
          return;
        }
        if (t.intent === 'horizontal' && e.currentTarget instanceof Element) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // The pointer is already gone; the next events will end the gesture.
          }
        }
      }
      if (t.intent === 'horizontal') setDrag(dragOffset(t.rest, dx, width()));
    },
    onPointerUp: (e: PointerEvent) => {
      finish(e, false);
    },
    onPointerCancel: (e: PointerEvent) => {
      finish(e, true);
      stop();
    },
    // Capture phase: a finished swipe must not click the chat open; a tap on an open row closes it.
    onClickCapture: (e: MouseEvent) => {
      // The revealed buttons (and the "⋮") are part of the row but are not the card.
      if ((e.target as Element).closest('[data-swipe-action]')) return;
      if (swallowClick.current) {
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (tapAction(open) === 'close') {
        e.preventDefault();
        e.stopPropagation();
        useOpenRow.getState().close();
      }
    },
  };

  const offset = drag ?? restOffsetFor(open);
  return {
    offset,
    dragging: drag !== null,
    /** Which side is showing buttons (while dragging, the side the card is moving towards). */
    revealed: offset > 0 ? ('start' as Side) : offset < 0 ? ('end' as Side) : null,
    open,
    handlers,
    /** Stops a swipe in progress (for example when a long press starts select mode). */
    cancel: stop,
  };
};
