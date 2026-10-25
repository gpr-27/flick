// The 1:1 call state machine, scenario by scenario: offer/answer/ICE order, glare, busy,
// timeouts, the reconnect grace period, device switching and screen sharing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { notify } from '@/components/ui/notify';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  BOB,
  CONV,
  type FakeApi,
  type FakeTransport,
  installFakeServices,
} from '../../../test/fakes';
import {
  FakePeer,
  FakeStream,
  installFakeWebRtc,
  makeTrack,
  type FakeMedia,
} from '../../../test/webrtcFakes';
import {
  CONNECT_FAILED_MESSAGE,
  CONNECT_TIMEOUT_MS,
  FAILURE_SHOWN_MS,
  RECONNECT_GRACE_MS,
  RING_TIMEOUT_MS,
  bindCallRealtime,
  useCallStore,
} from './useCallStore';

const CAROL = '0192f5a0-0000-7000-8000-000000000077';
const PEER = { id: BOB, display_name: 'Bob', avatar_url: null };
const OFFER = { type: 'offer' as const, sdp: 'v=0 offer' };
const ANSWER = { type: 'answer' as const, sdp: 'v=0 answer' };
const CALL_A = '0192f5a0-0000-7000-8000-0000000000a1';
const CALL_B = '0192f5a0-0000-7000-8000-0000000000b2';
const cand = (n: number) => ({ candidate: `candidate:${n}`, sdpMid: '0', sdpMLineIndex: 0 });

let transport: FakeTransport;
let api: FakeApi;
let media: FakeMedia;
let unbind: () => void;
const store = () => useCallStore.getState();
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const peer = (): FakePeer => FakePeer.all.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  media = installFakeWebRtc();
  ({ transport, api } = installFakeServices());
  api.call.mockResolvedValue({
    ice_servers: [{ urls: ['turn:t'] }],
    expires_at: '2999-01-01T00:00:00Z',
  });
  useChatStore.getState().reset();
  store()._cleanup();
  store().clearFailure();
  unbind = bindCallRealtime(transport);
});
afterEach(() => {
  unbind();
  store()._cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dial = async (type: 'audio' | 'video' = 'video') => {
  await store().initiateCall(CONV, PEER, type);
  return store().callId!;
};
const ringIn = (callId = CALL_A, from = BOB, media_: 'audio' | 'video' = 'video') =>
  transport.fire('call_offer', {
    call_id: callId,
    conversation_id: CONV,
    media: media_,
    sdp: OFFER,
    from_user_id: from,
  });
const remoteAnswers = async (callId: string) => {
  transport.fire('call_answer', { call_id: callId, sdp: ANSWER, from_user_id: BOB });
  await flush();
};

describe('outgoing call order', () => {
  it('shows "calling" before the permission prompt resolves, then offers with the media type', async () => {
    let release!: (s: FakeStream) => void;
    media.getUserMedia.mockReturnValueOnce(
      new Promise<FakeStream>((resolve) => {
        release = resolve;
      }),
    );
    const started = store().initiateCall(CONV, PEER, 'audio');
    expect(store()).toMatchObject({ callStatus: 'calling', isCaller: true, callType: 'audio' });
    expect(transport.sentOf('call_offer')).toEqual([]);
    release(new FakeStream([makeTrack('audio')]));
    await started;
    expect(transport.sentOf('call_offer')).toEqual([
      expect.objectContaining({
        conversation_id: CONV,
        media: 'audio',
        sdp: { type: 'offer', sdp: 'o' },
      }),
    ]);
  });

  it('negotiates a video line even without a camera so it can still receive video', async () => {
    media.hasCamera = false;
    await dial('video');
    expect(peer().transceivers.map((t) => [t.receiver.track.kind, t.direction])).toEqual([
      ['audio', 'sendrecv'],
      ['video', 'recvonly'],
    ]);
  });

  it('uses TURN credentials for the peer connection', async () => {
    await dial();
    expect(peer().config).toEqual({
      iceServers: [{ urls: ['turn:t'] }],
      iceTransportPolicy: 'all',
    });
  });

  it('sends local ICE candidates with the call id, and ignores the end-of-candidates marker', async () => {
    const callId = await dial();
    peer().onicecandidate?.({ candidate: { toJSON: () => cand(1) } });
    peer().onicecandidate?.({ candidate: null });
    expect(transport.sentOf('call_ice')).toEqual([{ call_id: callId, candidate: cand(1) }]);
  });

  it('the answer connects the call and clears the ring timeout', async () => {
    vi.useFakeTimers();
    const callId = await dial();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    transport.fire('call_answer', { call_id: callId, sdp: ANSWER, from_user_id: BOB });
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS + 1000);
    expect(store()).toMatchObject({ callStatus: 'connected', connectionState: 'connecting' });
    expect(peer().remoteDescription).toEqual(ANSWER);
  });

  it('an answer that cannot be applied ends the call with a message', async () => {
    const callId = await dial();
    peer().failRemote = true;
    await remoteAnswers(callId);
    expect(notify.error).toHaveBeenCalledWith('Call failed to connect');
    expect(store().callStatus).toBe('idle');
    expect(transport.sentOf('call_end')).toHaveLength(1);
  });

  it('nobody answers: gives up after RING_TIMEOUT_MS, tells the user and hangs up', async () => {
    vi.useFakeTimers();
    await dial();
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS - 1);
    expect(store().callStatus).toBe('calling');
    await vi.advanceTimersByTimeAsync(2);
    expect(store().callStatus).toBe('idle');
    expect(notify.info).toHaveBeenCalledWith("Bob didn't answer");
    expect(transport.sentOf('call_end')).toEqual([expect.objectContaining({ reason: 'hangup' })]);
  });

  it('hanging up while the permission prompt is open stops the microphone', async () => {
    let release!: (s: FakeStream) => void;
    const stream = new FakeStream([makeTrack('audio')]);
    media.getUserMedia.mockReturnValueOnce(
      new Promise<FakeStream>((r) => {
        release = r;
      }),
    );
    const started = store().initiateCall(CONV, PEER, 'audio');
    store().endCall();
    release(stream);
    await started;
    expect(stream.getTracks()[0]!.stop).toHaveBeenCalled();
    expect(store().callStatus).toBe('idle');
    expect(FakePeer.all).toHaveLength(0);
  });
});

describe('ICE ordering', () => {
  it('buffers candidates that arrive before the answer and applies them after it', async () => {
    const callId = await dial();
    transport.fire('call_ice', { call_id: callId, candidate: cand(1), from_user_id: BOB });
    transport.fire('call_ice', { call_id: callId, candidate: cand(2), from_user_id: BOB });
    expect(peer().addIceCandidate).not.toHaveBeenCalled();
    await remoteAnswers(callId);
    expect(
      peer().addIceCandidate.mock.calls.map((c) => (c[0] as { candidate: string }).candidate),
    ).toEqual(['candidate:1', 'candidate:2']);
  });

  it('applies candidates immediately once the remote description is set', async () => {
    const callId = await dial();
    await remoteAnswers(callId);
    transport.fire('call_ice', { call_id: callId, candidate: cand(3), from_user_id: BOB });
    expect(peer().addIceCandidate).toHaveBeenCalledTimes(1);
  });

  it('ignores candidates of another call and the null end marker', async () => {
    const callId = await dial();
    await remoteAnswers(callId);
    transport.fire('call_ice', { call_id: CALL_B, candidate: cand(1), from_user_id: BOB });
    transport.fire('call_ice', { call_id: callId, candidate: null, from_user_id: BOB });
    expect(peer().addIceCandidate).not.toHaveBeenCalled();
  });

  it('a candidate that fails to apply does not stop the next ones', async () => {
    const callId = await dial();
    transport.fire('call_ice', { call_id: callId, candidate: cand(1), from_user_id: BOB });
    transport.fire('call_ice', { call_id: callId, candidate: cand(2), from_user_id: BOB });
    peer().addIceCandidate.mockRejectedValueOnce(new Error('bad'));
    await remoteAnswers(callId);
    expect(peer().addIceCandidate).toHaveBeenCalledTimes(2);
  });

  it('candidates that arrive before the offer belong to that call and are kept', async () => {
    transport.fire('call_ice', { call_id: CALL_A, candidate: cand(1), from_user_id: BOB });
    transport.fire('call_ice', { call_id: CALL_B, candidate: cand(9), from_user_id: BOB });
    ringIn(CALL_A);
    expect(store()._pendingCandidates.map((c) => c.callId)).toEqual([CALL_A]);
    await store().acceptCall();
    expect(peer().addIceCandidate).toHaveBeenCalledTimes(1);
  });
});

describe('incoming call', () => {
  it('rings with the caller and the media type', () => {
    ringIn(CALL_A, BOB, 'audio');
    expect(store()).toMatchObject({
      callStatus: 'ringing',
      callId: CALL_A,
      callType: 'audio',
      isCaller: false,
      otherUser: { id: BOB },
    });
  });

  it('an unknown caller shows as "Unknown"', () => {
    ringIn(CALL_A, CAROL);
    expect(store().otherUser).toEqual({ id: CAROL, display_name: 'Unknown', avatar_url: null });
  });

  it('accepting applies the offer BEFORE adding tracks, then answers', async () => {
    ringIn();
    await store().acceptCall();
    expect(peer().calls.slice(0, 2)).toEqual(['setRemote', 'addTrack']);
    expect(peer().calls).toContain('setLocal');
    expect(transport.sentOf('call_answer')).toEqual([
      expect.objectContaining({ call_id: CALL_A, sdp: { type: 'answer', sdp: 'a' } }),
    ]);
    expect(store()).toMatchObject({
      callStatus: 'connected',
      connectionState: 'connecting',
      _incomingOffer: null,
    });
  });

  it('declining sends call_reject and clears the call', () => {
    ringIn();
    store().rejectCall();
    expect(transport.sentOf('call_reject')).toEqual([{ call_id: CALL_A }]);
    expect(store().callStatus).toBe('idle');
  });

  it('a denied microphone rejects the call and shows why', async () => {
    ringIn();
    media.rejectWith = 'NotAllowedError';
    await store().acceptCall();
    expect(transport.sentOf('call_reject')).toHaveLength(1);
    expect(store().callStatus).toBe('idle');
    expect(store().failure).toMatch(/permission/i);
  });

  it('accept with nothing ringing does nothing', async () => {
    await store().acceptCall();
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('the ringing safety net clears a call whose caller vanished', () => {
    vi.useFakeTimers();
    ringIn();
    vi.advanceTimersByTime(RING_TIMEOUT_MS + 5001);
    expect(store().callStatus).toBe('idle');
  });

  it('answering stops the ring safety net... the call stays up past the old timeout', async () => {
    vi.useFakeTimers();
    ringIn();
    await store().acceptCall();
    await vi.advanceTimersByTimeAsync(RING_TIMEOUT_MS + 6000);
    expect(store().callStatus).toBe('connected');
  });
});

describe('glare and busy', () => {
  it('a second incoming call while ringing gets call_busy and the first keeps ringing', () => {
    ringIn(CALL_A);
    ringIn(CALL_B, CAROL);
    expect(transport.sentOf('call_busy')).toEqual([{ call_id: CALL_B }]);
    expect(store()).toMatchObject({ callStatus: 'ringing', callId: CALL_A });
  });

  it('an incoming call while I am dialling gets call_busy (simultaneous calls: each side stays on its own)', async () => {
    const mine = await dial();
    ringIn(CALL_B, BOB);
    expect(transport.sentOf('call_busy')).toEqual([{ call_id: CALL_B }]);
    expect(store()).toMatchObject({ callId: mine, callStatus: 'calling', isCaller: true });
  });

  it('an incoming call during a connected call gets call_busy', async () => {
    const mine = await dial();
    await remoteAnswers(mine);
    ringIn(CALL_B, CAROL);
    expect(transport.sentOf('call_busy')).toHaveLength(1);
    expect(store().callStatus).toBe('connected');
  });

  it('the other side being busy ends my call with a message', async () => {
    const callId = await dial();
    transport.fire('call_busy', { call_id: callId, from_user_id: BOB });
    expect(notify.info).toHaveBeenCalledWith('Bob is on another call');
    expect(store().callStatus).toBe('idle');
  });

  it('dialling while already in a call is ignored', async () => {
    const mine = await dial();
    await store().initiateCall(CONV, PEER, 'audio');
    expect(store().callId).toBe(mine);
    expect(transport.sentOf('call_offer')).toHaveLength(1);
  });

  it('call_busy for a call that is not mine is ignored', async () => {
    await dial();
    transport.fire('call_busy', { call_id: CALL_B, from_user_id: BOB });
    expect(store().callStatus).toBe('calling');
  });
});

describe('how a call ends', () => {
  it('declined by the other side', async () => {
    const callId = await dial();
    transport.fire('call_reject', { call_id: callId, from_user_id: BOB });
    expect(notify.info).toHaveBeenCalledWith('Bob declined the call');
    expect(store().callStatus).toBe('idle');
  });

  it('hang-up by the other side during a call says "Call ended"', async () => {
    const callId = await dial();
    await remoteAnswers(callId);
    transport.fire('call_end', { call_id: callId, reason: 'hangup', from_user_id: BOB });
    expect(notify.info).toHaveBeenCalledWith('Call ended');
    expect(store().callStatus).toBe('idle');
  });

  it('the caller hanging up while I am still ringing is a missed call', () => {
    ringIn();
    transport.fire('call_end', { call_id: CALL_A, reason: 'hangup', from_user_id: BOB });
    expect(notify.info).toHaveBeenCalledWith('Missed call');
    expect(store().callStatus).toBe('idle');
  });

  it('answered on another of my devices stops the ring quietly', () => {
    ringIn();
    transport.fire('call_end', {
      call_id: CALL_A,
      reason: 'answered_elsewhere',
      from_user_id: BOB,
    });
    expect(notify.info).not.toHaveBeenCalled();
    expect(store().callStatus).toBe('idle');
  });

  it('answered_elsewhere does not end a call I am already in', async () => {
    const callId = await dial();
    await remoteAnswers(callId);
    transport.fire('call_end', {
      call_id: callId,
      reason: 'answered_elsewhere',
      from_user_id: BOB,
    });
    expect(store().callStatus).toBe('connected');
  });

  it.each([
    ['offline', /offline right now/],
    ['blocked', /can't call Bob/],
  ] as const)('call_unavailable (%s) explains why', async (reason, text) => {
    const callId = await dial();
    transport.fire('call_unavailable', { call_id: callId, reason });
    expect(store().callStatus).toBe('idle');
    expect(store().failure).toMatch(text);
  });

  it('events for another call never touch this one', async () => {
    await dial();
    transport.fire('call_end', { call_id: CALL_B, reason: 'hangup', from_user_id: BOB });
    transport.fire('call_reject', { call_id: CALL_B, from_user_id: BOB });
    transport.fire('call_answer', { call_id: CALL_B, sdp: ANSWER, from_user_id: BOB });
    expect(store().callStatus).toBe('calling');
  });

  it('ending releases the camera, the microphone and the peer, and keeps device preferences', async () => {
    await dial();
    const stream = store().localStream!;
    store().setAudioOutput('speaker-2');
    store().endCall();
    for (const t of stream.getTracks())
      expect((t as unknown as { stop: { mock: unknown } }).stop).toHaveBeenCalled();
    expect(peer().close).toHaveBeenCalled();
    expect(store()).toMatchObject({
      callStatus: 'idle',
      localStream: null,
      audioOutputId: 'speaker-2',
    });
  });

  it('unbinding stops reacting to signalling', () => {
    unbind();
    ringIn();
    expect(store().callStatus).toBe('idle');
    unbind = bindCallRealtime(transport);
  });
});

describe('renegotiation and the reconnect grace period', () => {
  const connected = async (asCaller = true) => {
    if (asCaller) {
      const callId = await dial();
      await remoteAnswers(callId);
      return callId;
    }
    ringIn();
    await store().acceptCall();
    return CALL_A;
  };

  it('a dropped path becomes "reconnecting" and the caller offers an ICE restart', async () => {
    await connected();
    peer().createOffer.mockClear();
    peer().setConnection('failed');
    await flush();
    expect(store().connectionState).toBe('reconnecting');
    expect(peer().createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(transport.sentOf('call_renegotiate')).toHaveLength(1);
  });

  it('the callee does not start the restart (avoids offer glare)', async () => {
    await connected(false);
    peer().createOffer.mockClear();
    peer().setConnection('failed');
    await flush();
    expect(peer().createOffer).not.toHaveBeenCalled();
    expect(store().connectionState).toBe('reconnecting');
  });

  it('recovering inside the grace period keeps the call', async () => {
    vi.useFakeTimers();
    await connected();
    peer().setConnection('disconnected');
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS - 1000);
    peer().setConnection('connected');
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS * 2);
    expect(store()).toMatchObject({
      callStatus: 'connected',
      connectionState: 'connected',
      failure: null,
    });
  });

  it('not recovering ends the call with a message, once', async () => {
    vi.useFakeTimers();
    await connected();
    peer().setConnection('disconnected');
    peer().setConnection('disconnected'); // flapping does not restart the clock
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS + 1);
    expect(store().callStatus).toBe('idle');
    expect(store().failure).toBe('Call dropped: the connection was lost.');
    expect(transport.sentOf('call_end')).toHaveLength(1);
  });

  it('the failure message disappears by itself after FAILURE_SHOWN_MS', async () => {
    vi.useFakeTimers();
    await connected();
    peer().setConnection('disconnected');
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS + 1);
    expect(store().failure).not.toBeNull();
    await vi.advanceTimersByTimeAsync(FAILURE_SHOWN_MS + 1);
    expect(store().failure).toBeNull();
  });

  it('a renegotiation offer from the other side is answered; an answer is only applied', async () => {
    const callId = await connected(false);
    transport.fire('call_renegotiate', { call_id: callId, sdp: OFFER, from_user_id: BOB });
    await flush();
    expect(transport.sentOf('call_renegotiate')).toEqual([
      expect.objectContaining({ sdp: { type: 'answer', sdp: 'a' } }),
    ]);
    transport.fire('call_renegotiate', { call_id: callId, sdp: ANSWER, from_user_id: BOB });
    await flush();
    expect(transport.sentOf('call_renegotiate')).toHaveLength(1);
  });

  it('a renegotiation for another call is ignored', async () => {
    await connected();
    transport.fire('call_renegotiate', { call_id: CALL_B, sdp: OFFER, from_user_id: BOB });
    await flush();
    expect(transport.sentOf('call_renegotiate')).toEqual([]);
  });

  it('no renegotiation while the connection is mid-negotiation', async () => {
    await connected();
    peer().signalingState = 'have-local-offer';
    await store()._negotiate();
    expect(transport.sentOf('call_renegotiate')).toEqual([]);
  });
});

describe('mute, camera and devices', () => {
  it('mute and camera toggles flip the real tracks and come back', async () => {
    await dial('video');
    const stream = store().localStream!;
    store().toggleMute();
    expect(store().isMuted).toBe(true);
    expect(stream.getAudioTracks()[0]!.enabled).toBe(false);
    store().toggleMute();
    expect(stream.getAudioTracks()[0]!.enabled).toBe(true);
    store().toggleCamera();
    expect(store().isCameraOff).toBe(true);
    expect(stream.getVideoTracks()[0]!.enabled).toBe(false);
    store().toggleCamera();
    expect(stream.getVideoTracks()[0]!.enabled).toBe(true);
  });

  it('toggles without a call only flip the flag', () => {
    expect(() => {
      store().toggleMute();
    }).not.toThrow();
    expect(store().isMuted).toBe(true);
  });

  it('lists devices by kind', async () => {
    const d = (kind: string, id: string) => ({ kind, deviceId: id, label: id });
    media.enumerateDevices.mockResolvedValueOnce([
      d('audioinput', 'm1'),
      d('audiooutput', 's1'),
      d('videoinput', 'c1'),
      d('videoinput', 'c2'),
    ]);
    await store().loadDevices();
    expect(store().devices.mics).toHaveLength(1);
    expect(store().devices.speakers).toHaveLength(1);
    expect(store().devices.cameras).toHaveLength(2);
  });

  it('a failure listing devices is harmless', async () => {
    media.enumerateDevices.mockRejectedValueOnce(new Error('x'));
    await expect(store().loadDevices()).resolves.toBeUndefined();
  });

  it('switching microphone swaps the sender track, keeps the mute state and bumps the epoch', async () => {
    await dial('audio');
    store().toggleMute();
    const before = store().streamEpoch;
    await store().setAudioInput('mic-2');
    expect(media.getUserMedia).toHaveBeenLastCalledWith({
      audio: { deviceId: { exact: 'mic-2' } },
    });
    const sender = peer()
      .getSenders()
      .find((s) => s.track?.kind === 'audio');
    expect(sender?.replaceTrack).toHaveBeenCalled();
    expect(store().localStream!.getAudioTracks()).toHaveLength(1);
    expect(store().localStream!.getAudioTracks()[0]!.enabled).toBe(false);
    expect(store()).toMatchObject({ audioInputId: 'mic-2', streamEpoch: before + 1 });
  });

  it('switching camera swaps the sender track and keeps camera-off', async () => {
    await dial('video');
    store().toggleCamera();
    await store().setVideoInput('cam-2');
    expect(store().localStream!.getVideoTracks()).toHaveLength(1);
    expect(store().localStream!.getVideoTracks()[0]!.enabled).toBe(false);
    expect(store().videoInputId).toBe('cam-2');
  });

  it('a device that cannot be opened keeps the old one and tells the user', async () => {
    await dial('audio');
    const old = store().audioInputId;
    media.rejectWith = 'NotReadableError';
    await store().setAudioInput('mic-2');
    expect(notify.error).toHaveBeenCalledWith('Could not switch microphone');
    expect(store().audioInputId).toBe(old);
    await store().setVideoInput('cam-2');
    expect(notify.error).toHaveBeenCalledWith('Could not switch camera');
  });

  it('choosing a device before any call just remembers it', async () => {
    await store().setAudioInput('mic-9');
    await store().setVideoInput('cam-9');
    expect(store()).toMatchObject({ audioInputId: 'mic-9', videoInputId: 'cam-9' });
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('starting a call: refusals', () => {
  it('not connected: a message and no call', async () => {
    transport.state = 'reconnecting';
    await store().initiateCall(CONV, PEER, 'audio');
    expect(notify.error).toHaveBeenCalled();
    expect(store().callStatus).toBe('idle');
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it('no media support (insecure page): a failure message', async () => {
    Reflect.deleteProperty(navigator, 'mediaDevices');
    await store().initiateCall(CONV, PEER, 'audio');
    expect(store().failure).toMatch(/secure connection/);
    expect(store().callStatus).toBe('idle');
  });

  it.each([
    ['NotAllowedError', /permission/i],
    ['SecurityError', /permission/i],
    ['NotFoundError', /No microphone/],
    ['NotReadableError', /in use by another app/],
    ['SomethingElse', /Could not access/],
  ])('%s -> a readable reason', async (name, text) => {
    media.rejectWith = name;
    await store().initiateCall(CONV, PEER, 'audio');
    expect(store().failure).toMatch(text);
    expect(store().callStatus).toBe('idle');
  });

  it('a video call on a machine whose camera fails joins with audio only', async () => {
    media.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotFoundError' }),
    );
    await store().initiateCall(CONV, PEER, 'video');
    expect(notify.info).toHaveBeenCalledWith('No camera available — joining with audio only');
    expect(store().callStatus).toBe('calling');
  });

  it('starting a new call clears an old failure message', async () => {
    store()._fail('old news');
    await dial();
    expect(store().failure).toBeNull();
  });
});

describe('screen share rules', () => {
  const upToConnected = async (type: 'audio' | 'video') => {
    const callId = await dial(type);
    await remoteAnswers(callId);
  };

  it('is not available in an audio call', async () => {
    await upToConnected('audio');
    await store().startScreenShare();
    expect(media.getDisplayMedia).not.toHaveBeenCalled();
  });

  it('sharing twice asks the browser only once', async () => {
    await upToConnected('video');
    await store().startScreenShare();
    await store().startScreenShare();
    expect(media.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(store().isSharing).toBe(true);
  });

  it('a share that cannot be started tells the user (but not when the picker is just closed)', async () => {
    await upToConnected('video');
    media.getDisplayMedia.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );
    await store().startScreenShare();
    expect(notify.error).not.toHaveBeenCalled();
    media.getDisplayMedia.mockRejectedValueOnce(new Error('boom'));
    await store().startScreenShare();
    expect(notify.error).toHaveBeenCalledWith('Could not share your screen.');
  });

  it('stop sharing returns to the camera', async () => {
    await upToConnected('video');
    await store().startScreenShare();
    const sender = peer()
      .getTransceivers()
      .find((t) => t.receiver.track.kind === 'video')!.sender;
    await store().stopScreenShare();
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(media.camera);
    expect(store()).toMatchObject({ isSharing: false, screenStream: null });
  });

  it('stopScreenShare with nothing shared does nothing', async () => {
    await upToConnected('video');
    await store().stopScreenShare();
    expect(store().isSharing).toBe(false);
  });
});

describe('a call whose media path never comes up', () => {
  it('ends with a clear message after the connect timeout, not "Reconnecting" for ever', async () => {
    vi.useFakeTimers();
    const callId = await dial();
    await remoteAnswers(callId);
    peer().setConnection('connecting');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1000);
    expect(store().callStatus).not.toBe('idle');

    await vi.advanceTimersByTimeAsync(2000);
    expect(store().callStatus).toBe('idle');
    expect(store().failure).toBe(CONNECT_FAILED_MESSAGE);
    expect(transport.sentOf('call_end')).toHaveLength(1);
  });

  it('a path that comes up in time keeps the call, with no message', async () => {
    vi.useFakeTimers();
    const callId = await dial();
    await remoteAnswers(callId);
    peer().setConnection('connecting');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 5000);
    peer().setConnection('connected');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2);
    expect(store()).toMatchObject({
      callStatus: 'connected',
      connectionState: 'connected',
      failure: null,
    });
  });
});
