// Arithmetic for the page-level touch gestures (edge swipe back, swipe down to dismiss).
// No React and no DOM, so every threshold can be tested with plain numbers. The message gestures
// keep their own rules in features/chat/gestures/gestureMath.ts; the sheet distance is shared.
import { SHEET_CLOSE_PX, sheetOffset } from '@/features/chat/gestures/gestureMath';

/** A touch that starts within this many pixels of the left edge may be a back swipe. */
export const EDGE_ZONE_PX = 24;
/** How far a finger moves before we decide which way it is going. */
export const LOCK_SLOP_PX = 8;
/** Letting go past this share of the screen width goes back. */
export const BACK_COMMIT_RATIO = 0.33;
/** A quick flick (px per ms) goes back even if it is short ... */
export const FLICK_VELOCITY = 0.5;
/** ... but only after at least this far. */
export const FLICK_MIN_PX = 40;
/** A quick downward flick closes a sheet even if it is short. */
export const SHEET_FLICK_VELOCITY = 0.6;
export const SHEET_FLICK_MIN_PX = 24;

export type Axis = 'undecided' | 'horizontal' | 'vertical';

/** Which way is the finger going? Once decided, the caller keeps that axis for the whole touch. */
export const lockAxis = (dx: number, dy: number): Axis => {
  if (Math.hypot(dx, dy) < LOCK_SLOP_PX) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
};

export const isInEdgeZone = (x: number, zone: number = EDGE_ZONE_PX): boolean =>
  x >= 0 && x <= zone;

/** A touch may start a back swipe only from the edge, and only when the page is not overlaid. */
export const canStartBackSwipe = (x: number, enabled: boolean): boolean =>
  enabled && isInEdgeZone(x);

/** The page follows the finger one to one to the right, never left, never past the screen. */
export const backSwipeOffset = (dx: number, width: number): number =>
  Math.min(Math.max(0, width), Math.max(0, dx));

/** Pixels per millisecond between two samples (0 when no time has passed). */
export const velocity = (distance: number, elapsedMs: number): number =>
  elapsedMs > 0 ? distance / elapsedMs : 0;

/** Did the finger let go in a way that means "go back"? */
export const isBackSwipeCommit = (dx: number, vx: number, width: number): boolean =>
  dx >= width * BACK_COMMIT_RATIO || (vx >= FLICK_VELOCITY && dx >= FLICK_MIN_PX);

/** Dismiss a sheet: dragged far enough, or flicked down quickly. */
export const isSheetSwipeDismiss = (dy: number, vy: number): boolean =>
  dy >= SHEET_CLOSE_PX || (vy >= SHEET_FLICK_VELOCITY && dy >= SHEET_FLICK_MIN_PX);

export { sheetOffset };

/** Short enough to feel instant, long enough to read as motion. */
export const SETTLE_MS = 180;

/** CSS transition for settling back or flying out after the finger lifts. */
export const settleTransition = (
  reducedMotion: boolean,
  property: 'transform' | 'translate' = 'transform',
): string =>
  reducedMotion ? 'none' : `${property} ${String(SETTLE_MS)}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
