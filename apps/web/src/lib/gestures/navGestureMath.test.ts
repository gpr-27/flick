import { describe, expect, it } from 'vitest';
import {
  BACK_COMMIT_RATIO,
  EDGE_ZONE_PX,
  backSwipeOffset,
  canStartBackSwipe,
  isBackSwipeCommit,
  isInEdgeZone,
  isSheetSwipeDismiss,
  lockAxis,
  settleTransition,
  velocity,
} from './navGestureMath';

describe('lockAxis', () => {
  it('waits inside the slop', () => {
    expect(lockAxis(3, 3)).toBe('undecided');
    expect(lockAxis(0, 0)).toBe('undecided');
  });
  it('locks to the dominant axis', () => {
    expect(lockAxis(20, 5)).toBe('horizontal');
    expect(lockAxis(-20, 5)).toBe('horizontal');
    expect(lockAxis(5, 20)).toBe('vertical');
    expect(lockAxis(5, -20)).toBe('vertical');
  });
});

describe('edge zone', () => {
  it('accepts only the first pixels', () => {
    expect(isInEdgeZone(0)).toBe(true);
    expect(isInEdgeZone(EDGE_ZONE_PX)).toBe(true);
    expect(isInEdgeZone(EDGE_ZONE_PX + 1)).toBe(false);
    expect(isInEdgeZone(-1)).toBe(false);
  });
  it('needs the gesture to be enabled', () => {
    expect(canStartBackSwipe(10, true)).toBe(true);
    expect(canStartBackSwipe(10, false)).toBe(false);
    expect(canStartBackSwipe(100, true)).toBe(false);
  });
});

describe('backSwipeOffset', () => {
  it('follows the finger rightwards, clamped to the screen', () => {
    expect(backSwipeOffset(50, 400)).toBe(50);
    expect(backSwipeOffset(-30, 400)).toBe(0);
    expect(backSwipeOffset(900, 400)).toBe(400);
  });
});

describe('velocity', () => {
  it('is distance over time', () => {
    expect(velocity(100, 50)).toBe(2);
    expect(velocity(100, 0)).toBe(0);
  });
});

describe('isBackSwipeCommit', () => {
  const width = 400;
  it('commits past a third of the screen', () => {
    expect(isBackSwipeCommit(width * BACK_COMMIT_RATIO, 0, width)).toBe(true);
    expect(isBackSwipeCommit(width * BACK_COMMIT_RATIO - 1, 0, width)).toBe(false);
  });
  it('commits on a quick flick that went a little way', () => {
    expect(isBackSwipeCommit(60, 0.8, width)).toBe(true);
    expect(isBackSwipeCommit(20, 2, width)).toBe(false);
    expect(isBackSwipeCommit(60, 0.2, width)).toBe(false);
  });
});

describe('isSheetSwipeDismiss', () => {
  it('closes after a long drag or a quick flick', () => {
    expect(isSheetSwipeDismiss(80, 0)).toBe(true);
    expect(isSheetSwipeDismiss(79, 0)).toBe(false);
    expect(isSheetSwipeDismiss(30, 1)).toBe(true);
    expect(isSheetSwipeDismiss(10, 3)).toBe(false);
  });
});

describe('settleTransition', () => {
  it('is off with reduced motion', () => {
    expect(settleTransition(true)).toBe('none');
    expect(settleTransition(false)).toContain('transform');
  });
});
