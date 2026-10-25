import { describe, expect, it } from 'vitest';
import {
  BUTTON_PX,
  classifyIntent,
  dragOffset,
  openWidth,
  resolveRelease,
  restOffsetFor,
  tapAction,
  triggerDistance,
} from './swipeGesture';
import { useOpenRow } from './useOpenRow';

describe('swipe gesture maths', () => {
  it('waits for 8px before deciding, then separates swipes from scrolls', () => {
    expect(classifyIntent(5, 3)).toBe('pending');
    expect(classifyIntent(20, 4)).toBe('horizontal');
    expect(classifyIntent(-20, 4)).toBe('horizontal');
    expect(classifyIntent(4, 20)).toBe('vertical');
    expect(classifyIntent(12, 12)).toBe('vertical'); // a diagonal drag still scrolls
  });

  it('follows the finger from where the row rests, within limits', () => {
    expect(dragOffset(0, -50, 400)).toBe(-50);
    expect(dragOffset(restOffsetFor('end'), -20, 400)).toBe(-openWidth('end') - 20);
    expect(dragOffset(0, 9999, 400)).toBe(360);
  });

  it('opens on a short swipe, closes on a tiny one, triggers on a long one', () => {
    expect(resolveRelease(-10, 400)).toEqual({ kind: 'close' });
    expect(resolveRelease(-openWidth('end') / 2, 400)).toEqual({ kind: 'open', side: 'end' });
    expect(resolveRelease(openWidth('start') / 2, 400)).toEqual({ kind: 'open', side: 'start' });
    expect(resolveRelease(-triggerDistance(400), 400)).toEqual({ kind: 'trigger', side: 'end' });
    expect(resolveRelease(triggerDistance(400), 400)).toEqual({ kind: 'trigger', side: 'start' });
    expect(triggerDistance(400)).toBeGreaterThan(BUTTON_PX * 3);
  });

  it('a tap on an open row closes it instead of opening the chat', () => {
    expect(tapAction(null)).toBe('open-chat');
    expect(tapAction('end')).toBe('close');
  });

  it('only one row is open at a time', () => {
    const { open, close } = useOpenRow.getState();
    open('a', 'end');
    open('b', 'start');
    expect(useOpenRow.getState()).toMatchObject({ openId: 'b', side: 'start' });
    close();
    expect(useOpenRow.getState().openId).toBeNull();
  });
});
