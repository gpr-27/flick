import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { notify } from '@/components/ui/notify';
import {
  answerCallIdFromUrl,
  handleServiceWorkerMessage,
  usePendingOpen,
} from '@/pwa/openFromNotification';
import { ANSWER_WAIT_MS, useAnswerFromNotification } from './useAnswerFromNotification';
import { useCallStore } from './useCallStore';

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  usePendingOpen.setState({ conversationId: null, answerCallId: null });
  useCallStore.getState()._cleanup();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('?answer=<call id>', () => {
  it('is read from a launch URL and from a message of the service worker', () => {
    expect(answerCallIdFromUrl('/?answer=abc')).toBe('abc');
    expect(answerCallIdFromUrl('/?c=abc')).toBeNull();
    handleServiceWorkerMessage(
      new MessageEvent('message', { data: { type: 'open-url', url: '/?answer=xyz' } }),
    );
    expect(usePendingOpen.getState().answerCallId).toBe('xyz');
  });
});

describe('useAnswerFromNotification', () => {
  it('clears the request once the call is on screen, without saying anything', () => {
    usePendingOpen.setState({ answerCallId: 'c1' });
    const { rerender } = renderHook(() => {
      useAnswerFromNotification(true);
    });
    act(() => {
      useCallStore.setState({ callId: 'c1', callStatus: 'ringing' });
    });
    rerender();
    expect(usePendingOpen.getState().answerCallId).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ANSWER_WAIT_MS + 1);
    });
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('says the call has ended when it never arrives (caller hung up, window passed)', () => {
    usePendingOpen.setState({ answerCallId: 'c1' });
    renderHook(() => {
      useAnswerFromNotification(true);
    });
    act(() => {
      vi.advanceTimersByTime(ANSWER_WAIT_MS + 1);
    });
    expect(notify.info).toHaveBeenCalledWith('That call has ended.');
    expect(usePendingOpen.getState().answerCallId).toBeNull();
  });

  it('waits while the app is still signing in', () => {
    usePendingOpen.setState({ answerCallId: 'c1' });
    renderHook(() => {
      useAnswerFromNotification(false);
    });
    act(() => {
      vi.advanceTimersByTime(ANSWER_WAIT_MS * 3);
    });
    expect(notify.info).not.toHaveBeenCalled();
    expect(usePendingOpen.getState().answerCallId).toBe('c1');
  });
});
