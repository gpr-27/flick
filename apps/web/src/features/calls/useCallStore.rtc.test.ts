// The 1:1 call with a fake WebRTC stack: ICE servers, the call's states, screen sharing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { config } from '@/config/env';
import { notify } from '@/components/ui/notify';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  BOB,
  CONV,
  type FakeApi,
  type FakeTransport,
  installFakeServices,
} from '../../../test/fakes';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { RECONNECT_GRACE_MS, bindCallRealtime, useCallStore } from './useCallStore';

// ── fake WebRTC / media ────────────────────────────────────────────────────

const track = (kind: 'audio' | 'video') => ({
  kind,
  enabled: true,
  muted: false,
  readyState: 'live',
  onended: null as (() => void) | null,
  stop: vi.fn(),
  getSettings: () => ({ deviceId: `${kind}-device` }),
});
type FakeTrack = ReturnType<typeof track>;

class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks.filter((t) => t.kind === 'audio');
  getVideoTracks = () => this.tracks.filter((t) => t.kind === 'video');
  addTrack = (t: FakeTrack) => void this.tracks.push(t);
  removeTrack = (t: FakeTrack) => void (this.tracks = this.tracks.filter((x) => x !== t));
}

const transceiver = (kind: 'audio' | 'video', sent: FakeTrack | null, direction: string) => {
  const t = {
    direction,
    receiver: { track: { kind } },
    sender: {
      track: sent,
      replaceTrack: vi.fn((next: FakeTrack | null) => {
        t.sender.track = next;
        return Promise.resolve();
      }),
    },
  };
  return t;
};

class FakePeer {
  static all: FakePeer[] = [];
  connectionState = 'new';
  signalingState = 'stable';
  remoteDescription: unknown = null;
  localDescription: { toJSON: () => unknown } | null = null;
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: ReturnType<typeof transceiver>[] = [];
  createOffer = vi.fn(() => Promise.resolve({ type: 'offer', sdp: 'o' }));
  createAnswer = vi.fn(() => Promise.resolve({ type: 'answer', sdp: 'a' }));
  close = vi.fn();
  constructor(readonly config: RTCConfiguration) {
    FakePeer.all.push(this);
  }
  addTrack(t: FakeTrack) {
    const x = transceiver(t.kind, t, 'sendrecv');
    this.transceivers.push(x);
    return x.sender;
  }
  addTransceiver(kind: 'audio' | 'video', init: { direction: string }) {
    this.transceivers.push(transceiver(kind, null, init.direction));
  }
  getTransceivers = () => this.transceivers;
  getSenders = () => this.transceivers.map((t) => t.sender);
  setLocalDescription(d: unknown) {
    this.localDescription = { toJSON: () => d };
    return Promise.resolve();
  }
  setRemoteDescription(d: unknown) {
    this.remoteDescription = d;
    return Promise.resolve();
  }
  addIceCandidate = vi.fn(() => Promise.resolve());
}

const camera = track('video');
const screen = track('video');
let withCamera = true;
const getUserMedia = vi.fn(() =>
  Promise.resolve(new FakeStream(withCamera ? [track('audio'), camera] : [track('audio')])),
);
const getDisplayMedia = vi.fn(() => Promise.resolve(new FakeStream([screen])));

// ── setup ──────────────────────────────────────────────────────────────────

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const PEER = { id: BOB, display_name: 'Bob', avatar_url: null };
const TURN = {
  ice_servers: [{ urls: ['turn:turn.test:3478'], username: 'u', credential: 'c' }],
  expires_at: '2026-01-01T00:00:00.000Z',
};

let transport: FakeTransport;
let api: FakeApi;
beforeEach(() => {
  vi.clearAllMocks();
  withCamera = true;
  FakePeer.all = [];
  camera.enabled = true;
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.stubGlobal('MediaStream', FakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, getDisplayMedia, enumerateDevices: () => Promise.resolve([]) },
  });
  ({ transport, api } = installFakeServices());
  api.call.mockResolvedValue(TURN);
  useChatStore.getState().reset();
  bindCallRealtime(transport);
  useCallStore.getState()._cleanup();
  useCallStore.getState().clearFailure();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const startVideoCall = async () => {
  await useCallStore.getState().initiateCall(CONV, PEER, 'video');
  const { callId } = useCallStore.getState();
  const peer = FakePeer.all[0];
  if (!callId || !peer) throw new Error('call did not start');
  return { callId, peer };
};
const answer = (callId: string) => {
  transport.fire('call_answer', {
    call_id: callId,
    sdp: { type: 'answer', sdp: 'a' },
    from_user_id: BOB,
  });
  return flush();
};

const like = (v: Record<string, unknown>): never => expect.objectContaining(v) as never;

// ── tests ──────────────────────────────────────────────────────────────────

describe('ICE servers', () => {
  it('uses the credentials from GET /calls/turn', async () => {
    const { peer } = await startVideoCall();
    expect(peer.config.iceServers).toEqual(TURN.ice_servers);
  });

  it('falls back to the configured STUN servers when the request fails', async () => {
    api.call.mockRejectedValue(new Error('offline'));
    const { peer } = await startVideoCall();
    expect(peer.config.iceServers).toEqual([...config.webrtc.iceServers]);
    expect(useCallStore.getState().callStatus).toBe('calling');
  });
});

describe('Settings > Calls', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it('"Always relay calls" makes the peer connection relay-only', async () => {
    const normal = await startVideoCall();
    expect(normal.peer.config.iceTransportPolicy).toBe('all');
    useCallStore.getState()._cleanup();
    FakePeer.all = [];
    useSettingsStore.getState().update({ relayOnly: true });
    const relayed = await startVideoCall();
    expect(relayed.peer.config.iceTransportPolicy).toBe('relay');
  });

  it('"Camera off by default" starts a video call with the camera off', async () => {
    useSettingsStore.getState().update({ cameraOffByDefault: true });
    await startVideoCall();
    expect(camera.enabled).toBe(false);
    expect(useCallStore.getState().isCameraOff).toBe(true);
  });

  it('the camera is on by default', async () => {
    await startVideoCall();
    expect(camera.enabled).toBe(true);
    expect(useCallStore.getState().isCameraOff).toBe(false);
  });

  it('noise suppression and echo cancellation reach getUserMedia', async () => {
    useSettingsStore.getState().update({ noiseSuppression: false, echoCancellation: false });
    await startVideoCall();
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: like({ noiseSuppression: false, echoCancellation: false }),
        video: expect.anything() as unknown,
      }),
    );
  });

  it('the video quality limits the outgoing bitrate', async () => {
    useSettingsStore.getState().update({ videoQuality: 'low' });
    const { peer } = await startVideoCall();
    const params = { encodings: [{} as { maxBitrate?: number }] };
    const sender = peer.transceivers.find((t) => t.sender.track?.kind === 'video')?.sender as
      { getParameters?: () => unknown; setParameters?: (p: unknown) => Promise<void> } | undefined;
    // The fake sender has no setParameters yet; give it one and start another call.
    useCallStore.getState()._cleanup();
    FakePeer.all = [];
    const setParameters = vi.fn(() => Promise.resolve());
    const original = FakePeer.prototype.addTrack;
    FakePeer.prototype.addTrack = function (this: FakePeer, t: FakeTrack) {
      const sent = original.call(this, t) as Record<string, unknown>;
      sent.getParameters = () => params;
      sent.setParameters = setParameters;
      return sent as never;
    };
    await startVideoCall();
    FakePeer.prototype.addTrack = original;
    expect(sender).toBeDefined();
    expect(setParameters).toHaveBeenCalledWith(like({ encodings: [{ maxBitrate: 400_000 }] }));
  });
});

describe('call states', () => {
  it('goes calling -> connecting -> connected, and reconnecting when the path drops', async () => {
    const { callId, peer } = await startVideoCall();
    expect(useCallStore.getState().callStatus).toBe('calling');
    expect(transport.sentOf('call_offer')).toHaveLength(1);

    await answer(callId);
    expect(useCallStore.getState()).toMatchObject({
      callStatus: 'connected',
      connectionState: 'connecting',
    });

    peer.connectionState = 'connected';
    peer.onconnectionstatechange?.();
    expect(useCallStore.getState().connectionState).toBe('connected');

    peer.connectionState = 'disconnected';
    peer.onconnectionstatechange?.();
    expect(useCallStore.getState().connectionState).toBe('reconnecting');
  });

  it('fails the call when the connection does not come back in time', async () => {
    const { callId, peer } = await startVideoCall();
    await answer(callId);
    vi.useFakeTimers();
    peer.connectionState = 'disconnected';
    peer.onconnectionstatechange?.();
    vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1);
    expect(useCallStore.getState().callStatus).toBe('idle');
    expect(useCallStore.getState().failure).toMatch(/connection was lost/);
    expect(transport.sentOf('call_end')).toHaveLength(1);
  });

  it('shows why a call could not be placed (call_unavailable)', async () => {
    const { callId } = await startVideoCall();
    transport.fire('call_unavailable', { call_id: callId, reason: 'offline' });
    expect(useCallStore.getState().callStatus).toBe('idle');
    expect(useCallStore.getState().failure).toMatch(/offline/);
  });

  it('reports a denied microphone as a failure and leaves no call behind', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    await useCallStore.getState().initiateCall(CONV, PEER, 'audio');
    expect(useCallStore.getState().callStatus).toBe('idle');
    expect(useCallStore.getState().failure).toMatch(/permission/);
  });
});

describe('screen sharing', () => {
  it('swaps the outgoing video for the screen and back to the camera when sharing stops', async () => {
    const { callId, peer } = await startVideoCall();
    await answer(callId);
    const video = peer.transceivers.find((t) => t.receiver.track.kind === 'video');

    await useCallStore.getState().startScreenShare();
    expect(video?.sender.replaceTrack).toHaveBeenCalledWith(screen);
    expect(useCallStore.getState().isSharing).toBe(true);
    expect(peer.createOffer).toHaveBeenCalledTimes(1); // no renegotiation: the line already sends

    await useCallStore.getState().stopScreenShare();
    expect(video?.sender.replaceTrack).toHaveBeenLastCalledWith(camera);
    expect(screen.stop).toHaveBeenCalled();
    expect(useCallStore.getState().isSharing).toBe(false);
  });

  it('handles "Stop sharing" in the browser bar (the track ends by itself)', async () => {
    const { callId, peer } = await startVideoCall();
    await answer(callId);
    await useCallStore.getState().startScreenShare();

    screen.onended?.();
    await flush();

    const video = peer.transceivers.find((t) => t.receiver.track.kind === 'video');
    expect(useCallStore.getState().isSharing).toBe(false);
    expect(video?.sender.track).toBe(camera);
  });

  it('turns a receive-only video line into a sending one and renegotiates', async () => {
    withCamera = false;
    const { callId, peer } = await startVideoCall();
    await answer(callId);
    const video = peer.transceivers.find((t) => t.receiver.track.kind === 'video');
    expect(video?.direction).toBe('recvonly');

    await useCallStore.getState().startScreenShare();
    expect(video?.direction).toBe('sendrecv');
    expect(transport.sentOf('call_renegotiate')).toHaveLength(1);

    await useCallStore.getState().stopScreenShare();
    expect(video?.sender.replaceTrack).toHaveBeenLastCalledWith(null);
  });

  it('does nothing when the user closes the screen picker', async () => {
    const { callId } = await startVideoCall();
    await answer(callId);
    getDisplayMedia.mockRejectedValueOnce(new DOMException('cancel', 'NotAllowedError'));
    await useCallStore.getState().startScreenShare();
    expect(useCallStore.getState().isSharing).toBe(false);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('stops the shared screen when the call ends', async () => {
    const { callId } = await startVideoCall();
    await answer(callId);
    await useCallStore.getState().startScreenShare();
    useCallStore.getState().endCall();
    expect(screen.stop).toHaveBeenCalled();
    expect(useCallStore.getState().isSharing).toBe(false);
  });
});
