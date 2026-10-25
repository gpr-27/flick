import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useLongPress } from '../useLongPress';
import {
  TAP_MAX_MS,
  isDeliberateSelection,
  isDoubleTap,
  isReplySwipe,
  swipeIntent,
  swipeOffset,
  swipeProgress,
  swipeTransition,
  type SwipeIntent,
  type Tap,
} from './gestureMath';
import { haptic } from './haptics';

/** Things inside a bubble that have their own tap meaning; a double tap on them is not a heart. */
const OWN_TAP = 'a,button,input,textarea,audio,video,summary,[role="slider"]';

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface MessageGestureOptions {
  /** False for deleted, still-sending and system messages: no gesture does anything. */
  canAct: boolean;
  /** While choosing several messages a tap selects, so none of these gestures apply. */
  selecting: boolean;
  /** Hold: opens the actions. `target` is what was under the finger (a link, say). */
  onLongPress: (target: Element | null) => void;
  /** Swiped far enough to the right. */
  onReply: () => void;
  /** Double tap (touch) or double click (mouse). */
  onHeart: () => void;
}

/**
 * Everything a message bubble does with a finger or a mouse, in one place: hold for the menu,
 * drag right to reply, double tap for a heart. Spread `bubbleProps` on the bubble; draw it with
 * `style` and the arrow with `progress`.
 *
 * The bubble must have `touch-action: pan-y`, so the browser keeps up-and-down scrolling and
 * hands us the sideways movement.
 */
export const useMessageGestures = ({
  canAct,
  selecting,
  onLongPress,
  onReply,
  onHeart,
}: MessageGestureOptions) => {
  // What the finger landed on, so a hold on a link can offer link actions.
  const pressTarget = useRef<Element | null>(null);
  const press = useLongPress(() => {
    onLongPress(pressTarget.current);
  });
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The finger that is down right now.
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  const intent = useRef<SwipeIntent>('undecided');
  const lastTap = useRef<Tap | null>(null);
  // A touch double tap is followed by a browser `dblclick`; this stops it counting twice.
  const lastTouchHeart = useRef(0);

  const reset = (): void => {
    start.current = null;
    intent.current = 'undecided';
    setDragging(false);
    setOffset(0);
  };

  const bubbleProps = {
    onPointerDown: (e: PointerEvent) => {
      if (!canAct || selecting) return;
      pressTarget.current = e.target instanceof Element ? e.target : null;
      if (e.pointerType !== 'mouse') {
        start.current = { x: e.clientX, y: e.clientY, time: e.timeStamp };
        intent.current = 'undecided';
      }
      press.onPointerDown(e);
    },
    onPointerMove: (e: PointerEvent) => {
      const from = start.current;
      if (!from) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (intent.current === 'undecided') {
        intent.current = swipeIntent(dx, dy);
        if (intent.current === 'swipe') {
          // A swipe is not a hold: stop the long-press timer, and keep the finger with us.
          press.onPointerCancel();
          setDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Not every environment can capture (and the finger keeps working without it).
          }
        }
      }
      if (intent.current === 'swipe') setOffset(swipeOffset(dx));
      else press.onPointerMove(e);
    },
    onPointerUp: (e: PointerEvent) => {
      const from = start.current;
      press.onPointerUp();
      if (!from) return;
      const dx = e.clientX - from.x;
      const swiped = intent.current === 'swipe';
      const wasTap = intent.current === 'undecided' && e.timeStamp - from.time <= TAP_MAX_MS;
      reset();
      if (swiped) {
        if (isReplySwipe(dx)) {
          haptic();
          onReply();
        }
        return;
      }
      if (!wasTap || (e.target as Element).closest(OWN_TAP)) return;
      const tap: Tap = { time: e.timeStamp, x: e.clientX, y: e.clientY };
      if (isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null;
        lastTouchHeart.current = e.timeStamp;
        onHeart();
      } else {
        lastTap.current = tap;
      }
    },
    onPointerCancel: () => {
      press.onPointerCancel();
      reset();
    },
    onPointerLeave: () => {
      press.onPointerLeave();
    },
    onClickCapture: press.onClickCapture,
    // The mouse way: a double click. It selects a word by itself, so that is cleared, unless
    // the person dragged out a longer piece of text on purpose.
    onDoubleClick: (e: MouseEvent) => {
      if (!canAct || selecting || (e.target as Element).closest(OWN_TAP)) return;
      if (e.timeStamp - lastTouchHeart.current < 600) return;
      const selection = window.getSelection();
      if (isDeliberateSelection(selection?.toString() ?? '')) return;
      selection?.removeAllRanges();
      onHeart();
    },
  };

  return {
    bubbleProps,
    /** Inline style for the bubble: it slides with the finger and springs back. */
    style: {
      translate: offset > 0 ? `${offset}px 0` : undefined,
      transition: swipeTransition(dragging, prefersReducedMotion()),
    },
    /** 0 to 1; above 0 only while a swipe is under way. */
    progress: swipeProgress(offset),
    offset,
  };
};
