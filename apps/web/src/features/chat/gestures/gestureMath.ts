// The arithmetic behind the message gestures. No React and no DOM in here, so every rule can be
// tested with plain numbers; the hooks next to this file only feed it pointer positions.

/** How far a finger must move before we decide whether it is a swipe or a scroll. */
export const INTENT_PX = 8;
/** Letting go past this distance counts as "reply". */
export const REPLY_TRIGGER_PX = 48;
/** The bubble never moves further than this. */
export const REPLY_MAX_PX = 64;
/** Two taps this close in time (and place) make a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 24;
/** A tap is a quick touch; a longer one is a hold. */
export const TAP_MAX_MS = 300;
/** Dragging a bottom sheet down further than this closes it. */
export const SHEET_CLOSE_PX = 80;

export type SwipeIntent = 'undecided' | 'swipe' | 'scroll';

/**
 * What the finger is doing, from how far it has moved since it touched down.
 *  - 'undecided': still within the first few pixels.
 *  - 'swipe': mostly sideways and to the right (the only direction that replies).
 *  - 'scroll': mostly up or down, or to the left: leave it to the browser.
 */
export const swipeIntent = (dx: number, dy: number): SwipeIntent => {
  if (Math.hypot(dx, dy) < INTENT_PX) return 'undecided';
  return dx > 0 && Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
};

/**
 * How far the bubble moves for a finger that moved `dx`. It follows the finger one to one up to
 * the trigger, then gets harder to pull (a rubber band) and stops at the maximum.
 */
export const swipeOffset = (dx: number): number => {
  if (dx <= 0) return 0;
  if (dx <= REPLY_TRIGGER_PX) return dx;
  return Math.min(REPLY_MAX_PX, REPLY_TRIGGER_PX + (dx - REPLY_TRIGGER_PX) * 0.3);
};

/** 0 to 1: how visible the reply arrow is (fully there once the trigger is reached). */
export const swipeProgress = (offset: number): number =>
  Math.min(1, Math.max(0, offset / REPLY_TRIGGER_PX));

/** Did the finger let go far enough to reply? */
export const isReplySwipe = (dx: number): boolean => dx >= REPLY_TRIGGER_PX;

/** The CSS transition for the bubble: it follows the finger directly, then springs back. */
export const swipeTransition = (dragging: boolean, reducedMotion: boolean): string =>
  dragging || reducedMotion ? 'none' : 'translate 220ms cubic-bezier(0.34, 1.56, 0.64, 1)';

export interface Tap {
  time: number;
  x: number;
  y: number;
}

/** Is this tap the second half of a double tap? */
export const isDoubleTap = (previous: Tap | null, next: Tap): boolean =>
  previous !== null &&
  next.time - previous.time <= DOUBLE_TAP_MS &&
  Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_SLOP_PX;

/**
 * A double click selects one word on its own. Anything with a space in it was dragged out on
 * purpose, so the person is selecting text and the heart must stay out of the way.
 */
export const isDeliberateSelection = (selected: string): boolean => /\s/.test(selected.trim());

/** The distance a bottom sheet follows a finger dragged down (never up). */
export const sheetOffset = (dy: number): number => Math.max(0, dy);

export const isSheetDismiss = (dy: number): boolean => dy >= SHEET_CLOSE_PX;
