import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmLeaveChat, leaveDecision, onBeforeUnload, reportUploads } from './uploadGuard';

afterEach(() => {
  reportUploads({ cancellable: 0, running: 0 });
});

describe('leaveDecision', () => {
  it('does not ask when nothing is running', () => {
    expect(leaveDecision(0).confirm).toBe(false);
  });
  it('words the question by the count', () => {
    expect(leaveDecision(1).message).toBe('1 upload is still in progress. Leave and cancel it?');
    expect(leaveDecision(2).message).toBe(
      '2 uploads are still in progress. Leave and cancel them?',
    );
  });
});

describe('confirmLeaveChat', () => {
  it('lets the switch through without asking when idle', () => {
    const ask = vi.fn();
    expect(confirmLeaveChat(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it('blocks the switch when the person says no', () => {
    reportUploads({ cancellable: 2, running: 2 });
    expect(confirmLeaveChat(() => false)).toBe(false);
  });
  it('allows it when they agree', () => {
    reportUploads({ cancellable: 2, running: 2 });
    expect(confirmLeaveChat(() => true)).toBe(true);
  });
});

describe('onBeforeUnload', () => {
  it('warns only while uploads run', () => {
    const idle = new Event('beforeunload', { cancelable: true });
    onBeforeUnload(idle);
    expect(idle.defaultPrevented).toBe(false);
    reportUploads({ cancellable: 0, running: 1 });
    const busy = new Event('beforeunload', { cancelable: true });
    onBeforeUnload(busy);
    expect(busy.defaultPrevented).toBe(true);
  });
});
