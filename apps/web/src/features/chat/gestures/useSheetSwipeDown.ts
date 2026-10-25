import { useRef, useState, type PointerEvent } from 'react';
import { isSheetDismiss, sheetOffset } from './gestureMath';

/**
 * Drag a phone bottom sheet down to close it. Spread `props` on the sheet (give it `touch-pan-x`
 * so the browser leaves up-and-down movement to us) and `style` too. A mouse is ignored; the
 * sheet has Escape and a backdrop for that.
 */
export const useSheetSwipeDown = (onClose: () => void) => {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ x: number; y: number } | null>(null);

  const reset = (): void => {
    from.current = null;
    setDragging(false);
    setOffset(0);
  };

  return {
    props: {
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        from.current = { x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: PointerEvent) => {
        const start = from.current;
        if (!start) return;
        const dy = e.clientY - start.y;
        // Mostly downwards before it counts as a drag; a sideways wobble on a tap does not.
        if (!dragging && !(dy > 8 && dy > Math.abs(e.clientX - start.x))) return;
        setDragging(true);
        setOffset(sheetOffset(dy));
      },
      onPointerUp: (e: PointerEvent) => {
        const start = from.current;
        const close = dragging && start !== null && isSheetDismiss(e.clientY - start.y);
        reset();
        if (close) onClose();
      },
      onPointerCancel: reset,
    },
    style: {
      translate: offset > 0 ? `0 ${offset}px` : undefined,
      transition: dragging ? 'none' : 'translate 200ms ease-out',
    },
  };
};
