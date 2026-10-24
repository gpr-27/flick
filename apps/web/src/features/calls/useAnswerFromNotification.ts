import { useEffect } from 'react';
import { notify } from '@/components/ui/notify';
import { usePendingOpen } from '@/pwa/openFromNotification';
import { useCallStore } from './useCallStore';

/** How long to wait, after the user tapped "Answer", for the server to hand over the call. */
export const ANSWER_WAIT_MS = 12_000;

/**
 * The user tapped "Answer" on a call notification, so the app opened at `/?answer=<call id>`.
 * The server hands the parked offer over right after the connection is up, and the usual
 * incoming-call screen appears (Accept is focused). This hook only waits for that, and says so
 * if the call is already over (the caller hung up, or the ringing window passed).
 */
export const useAnswerFromNotification = (ready: boolean): void => {
  const callId = usePendingOpen((s) => s.answerCallId);
  const current = useCallStore((s) => s.callId);

  useEffect(() => {
    if (!callId || !ready) return;
    if (current === callId) {
      usePendingOpen.setState({ answerCallId: null }); // it is on screen
      return;
    }
    const timer = setTimeout(() => {
      if (useCallStore.getState().callId !== callId) notify.info('That call has ended.');
      usePendingOpen.setState({ answerCallId: null });
    }, ANSWER_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [callId, ready, current]);
};
