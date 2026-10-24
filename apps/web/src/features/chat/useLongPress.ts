import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

const HOLD_MS = 450;
// A finger always moves a little; more than this means the person is scrolling, not holding.
const MOVE_TOLERANCE_PX = 10;

/**
 * Touch "hold to open" like WhatsApp. Spread the result onto the element. A mouse is ignored
 * (it uses right-click or the actions button), and any movement or scroll cancels the hold.
 */
export const useLongPress = (onLongPress: () => void) => {
  // The latest callback, so a hold that started while the message was still sending uses the
  // message's state at the moment the hold completes, not the stale state from when it began.
  const latest = useRef(onLongPress);
  useEffect(() => {
    latest.current = onLongPress;
  });
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // The finger lifting after a hold still produces a click on whatever is underneath (a photo,
  // a quoted reply). It is swallowed so the menu opens without also triggering that.
  const justFired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        justFired.current = true;
        if ('vibrate' in navigator) navigator.vibrate(10);
        latest.current();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const start = origin.current;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture: (e: MouseEvent) => {
      if (!justFired.current) return;
      justFired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
};
