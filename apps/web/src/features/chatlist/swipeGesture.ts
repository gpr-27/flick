// The maths of swiping a chat row, kept free of React and the DOM so it can be tested on its own.
// Positive offsets move the card to the RIGHT (revealing the buttons on its left edge: mark
// unread, pin); negative offsets move it to the LEFT (revealing mute, archive, delete).

/** Finger travel before we decide whether this is a swipe or a scroll. */
export const INTENT_PX = 8;
/** Width of one revealed button. */
export const BUTTON_PX = 72;

export type Side = 'start' | 'end';
export type Intent = 'pending' | 'horizontal' | 'vertical';

/** How many buttons each side shows (start: unread + pin, end: mute + archive + delete). */
export const BUTTONS: Record<Side, number> = { start: 2, end: 3 };

/** How far the card rests open on a side. */
export const openWidth = (side: Side): number => BUTTONS[side] * BUTTON_PX;

/** Sideways travel that triggers the first action: past half the row, and past the buttons. */
export const triggerDistance = (rowWidth: number): number =>
  Math.max(rowWidth * 0.55, BUTTON_PX * 3 + 24);

/**
 * Horizontal or vertical? Nothing is decided until the finger has moved INTENT_PX. After that a
 * movement counts as a swipe only when it is clearly more sideways than up/down, so a slightly
 * diagonal scroll still scrolls.
 */
export const classifyIntent = (dx: number, dy: number): Intent => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < INTENT_PX) return 'pending';
  return ax > ay * 1.5 ? 'horizontal' : 'vertical';
};

/** Where the card is while the finger is down: the resting offset plus the drag, with limits. */
export const dragOffset = (restOffset: number, dx: number, rowWidth: number): number => {
  const raw = restOffset + dx;
  const limit = rowWidth * 0.9;
  return Math.max(-limit, Math.min(limit, raw));
};

/** The offset a row rests at when it is open on `side` (0 when closed). */
export const restOffsetFor = (open: Side | null): number =>
  open === 'start' ? openWidth('start') : open === 'end' ? -openWidth('end') : 0;

export type Release =
  | { kind: 'close' }
  | { kind: 'open'; side: Side }
  /** A long swipe: run the first action of that side (pin on `start`, archive on `end`). */
  | { kind: 'trigger'; side: Side };

/** What to do when the finger lifts at `offset`. */
export const resolveRelease = (offset: number, rowWidth: number): Release => {
  const side: Side = offset >= 0 ? 'start' : 'end';
  const distance = Math.abs(offset);
  if (distance >= triggerDistance(rowWidth)) return { kind: 'trigger', side };
  if (distance >= openWidth(side) / 2) return { kind: 'open', side };
  return { kind: 'close' };
};

/** A tap on a row that is open closes it instead of opening the chat. */
export const tapAction = (open: Side | null): 'open-chat' | 'close' =>
  open === null ? 'open-chat' : 'close';
