import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { notify } from '@/components/ui/notify';
import { useChatStore } from '@/features/chat/useChatStore';
import { BOB, CONV, type FakeTransport, installFakeServices } from '../../../test/fakes';
import { bindCallRealtime, useCallStore } from './useCallStore';

const sdp = { type: 'offer' as const, sdp: 'v=0' };
const CALL = '0192f5a0-0000-7000-8000-000000000032';
const OTHER = '0192f5a0-0000-7000-8000-000000000033';

let transport: FakeTransport;
beforeEach(() => {
  vi.clearAllMocks();
  ({ transport } = installFakeServices());
  useChatStore.getState().reset();
  bindCallRealtime(transport);
  useCallStore.getState()._cleanup();
});

const ring = (call_id = CALL, from = BOB) => {
  transport.fire('call_offer', {
    call_id,
    conversation_id: CONV,
    media: 'video',
    sdp,
    from_user_id: from,
  });
};

describe('call signalling', () => {
  it('rings on an incoming call and shows the caller', () => {
    useChatStore.setState({
      users: {
        [BOB]: { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false },
      },
    });
    ring();
    expect(useCallStore.getState()).toMatchObject({
      callStatus: 'ringing',
      callId: CALL,
      callType: 'video',
      isCaller: false,
    });
    expect(useCallStore.getState().otherUser?.display_name).toBe('Bob');
  });

  it('answers busy when already in a call', () => {
    ring();
    ring(OTHER);
    expect(transport.sentOf('call_busy')).toEqual([{ call_id: OTHER }]);
    expect(useCallStore.getState().callId).toBe(CALL);
  });

  it('ignores events for other calls and reports a missed call', () => {
    ring();
    transport.fire('call_end', { call_id: OTHER, reason: 'hangup', from_user_id: BOB });
    expect(useCallStore.getState().callStatus).toBe('ringing');
    transport.fire('call_end', { call_id: CALL, reason: 'hangup', from_user_id: BOB });
    expect(useCallStore.getState().callStatus).toBe('idle');
    expect(notify.info).toHaveBeenCalledWith('Missed call');
  });

  it('buffers ICE candidates that arrive before the call is answered', () => {
    ring();
    transport.fire('call_ice', {
      call_id: CALL,
      candidate: { candidate: 'cand-1' },
      from_user_id: BOB,
    });
    expect(useCallStore.getState()._pendingCandidates).toEqual([
      { callId: CALL, candidate: { candidate: 'cand-1' } },
    ]);
  });

  it('sends call_reject when declined', () => {
    ring();
    useCallStore.getState().rejectCall();
    expect(transport.sentOf('call_reject')).toEqual([{ call_id: CALL }]);
    expect(useCallStore.getState().callStatus).toBe('idle');
  });

  it('stops ringing quietly when another of our devices answered', () => {
    ring();
    transport.fire('call_end', { call_id: CALL, reason: 'answered_elsewhere', from_user_id: BOB });
    expect(useCallStore.getState().callStatus).toBe('idle');
    expect(notify.info).not.toHaveBeenCalled();
  });

  it('refuses to start a call while the realtime link is down', async () => {
    transport.state = 'reconnecting';
    await useCallStore
      .getState()
      .initiateCall(CONV, { id: BOB, display_name: 'Bob', avatar_url: null }, 'audio');
    expect(notify.error).toHaveBeenCalledWith('Not connected — please wait a moment and retry');
    expect(useCallStore.getState().callStatus).toBe('idle');
  });
});
