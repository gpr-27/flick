import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_MS,
  REPLY_MAX_PX,
  REPLY_TRIGGER_PX,
  isDeliberateSelection,
  isDoubleTap,
  isReplySwipe,
  isSheetDismiss,
  sheetOffset,
  swipeIntent,
  swipeOffset,
  swipeProgress,
  swipeTransition,
} from './gestureMath';
import { senderColor } from './senderColor';

describe('swipe intent', () => {
  it('waits until the finger has moved about 8 pixels', () => {
    expect(swipeIntent(0, 0)).toBe('undecided');
    expect(swipeIntent(5, 5)).toBe('undecided');
    expect(swipeIntent(8, 0)).toBe('swipe');
  });

  it('is a swipe when mostly to the right', () => {
    expect(swipeIntent(20, 6)).toBe('swipe');
  });

  it('is a scroll when mostly vertical, so scrolling is never blocked', () => {
    expect(swipeIntent(4, 30)).toBe('scroll');
    expect(swipeIntent(10, -40)).toBe('scroll');
  });

  it('ignores a drag to the left', () => {
    expect(swipeIntent(-30, 2)).toBe('scroll');
  });
});

describe('swipe distance', () => {
  it('follows the finger one to one up to the trigger', () => {
    expect(swipeOffset(20)).toBe(20);
    expect(swipeOffset(REPLY_TRIGGER_PX)).toBe(REPLY_TRIGGER_PX);
  });

  it('gets harder to pull after the trigger and stops at the maximum', () => {
    const past = swipeOffset(REPLY_TRIGGER_PX + 20);
    expect(past).toBeGreaterThan(REPLY_TRIGGER_PX);
    expect(past).toBeLessThan(REPLY_TRIGGER_PX + 20);
    expect(swipeOffset(500)).toBe(REPLY_MAX_PX);
  });

  it('never moves left of where the message sits', () => {
    expect(swipeOffset(-40)).toBe(0);
  });

  it('fades the arrow in until the trigger is reached', () => {
    expect(swipeProgress(0)).toBe(0);
    expect(swipeProgress(REPLY_TRIGGER_PX / 2)).toBeCloseTo(0.5);
    expect(swipeProgress(REPLY_MAX_PX)).toBe(1);
  });
});

describe('replying and springing back', () => {
  it('replies only when let go at or past the threshold', () => {
    expect(isReplySwipe(REPLY_TRIGGER_PX - 1)).toBe(false);
    expect(isReplySwipe(REPLY_TRIGGER_PX)).toBe(true);
    expect(isReplySwipe(90)).toBe(true);
  });

  it('springs back with a transition, but follows the finger without one', () => {
    expect(swipeTransition(true, false)).toBe('none');
    expect(swipeTransition(false, false)).toMatch(/^translate /);
  });

  it('does not animate at all when the person prefers reduced motion', () => {
    expect(swipeTransition(false, true)).toBe('none');
    expect(swipeTransition(true, true)).toBe('none');
  });
});

describe('double tap', () => {
  const tap = (time: number, x = 100, y = 100) => ({ time, x, y });

  it('needs a tap before it', () => {
    expect(isDoubleTap(null, tap(0))).toBe(false);
  });

  it('is two quick taps in the same place', () => {
    expect(isDoubleTap(tap(0), tap(DOUBLE_TAP_MS))).toBe(true);
  });

  it('is not two slow taps, or two taps far apart', () => {
    expect(isDoubleTap(tap(0), tap(DOUBLE_TAP_MS + 1))).toBe(false);
    expect(isDoubleTap(tap(0), tap(100, 200, 100))).toBe(false);
  });
});

describe('text selection', () => {
  it('treats the single word a double click selects as no selection', () => {
    expect(isDeliberateSelection('hello')).toBe(false);
    expect(isDeliberateSelection('hello ')).toBe(false);
    expect(isDeliberateSelection('')).toBe(false);
  });

  it('treats several words as a selection the person made on purpose', () => {
    expect(isDeliberateSelection('hello there')).toBe(true);
  });
});

describe('bottom sheet drag', () => {
  it('follows the finger down, never up', () => {
    expect(sheetOffset(30)).toBe(30);
    expect(sheetOffset(-30)).toBe(0);
  });

  it('closes only past the distance', () => {
    expect(isSheetDismiss(79)).toBe(false);
    expect(isSheetDismiss(80)).toBe(true);
  });
});

describe('sender colour', () => {
  it('is the same every time for one person and differs between people', () => {
    expect(senderColor('user-a')).toBe(senderColor('user-a'));
    expect(senderColor('user-a')).not.toBe(senderColor('user-b'));
  });
});
