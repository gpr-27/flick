// A small fake WebRTC + media stack, shared by call tests (store and overlay).
import { vi, type Mock } from 'vitest';

export interface FakeTrack {
  kind: 'audio' | 'video';
  enabled: boolean;
  muted: boolean;
  readyState: string;
  onended: (() => void) | null;
  stop: Mock;
  getSettings: () => { deviceId: string };
}

export const makeTrack = (kind: 'audio' | 'video', deviceId = `${kind}-device`): FakeTrack => ({
  kind,
  enabled: true,
  muted: false,
  readyState: 'live',
  onended: null,
  stop: vi.fn(),
  getSettings: () => ({ deviceId }),
});

export class FakeStream {
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

export class FakePeer {
  static all: FakePeer[] = [];
  connectionState = 'new';
  signalingState = 'stable';
  remoteDescription: unknown = null;
  localDescription: { toJSON: () => unknown } | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: ReturnType<typeof transceiver>[] = [];
  createOffer: Mock = vi.fn((_options?: unknown) => Promise.resolve({ type: 'offer', sdp: 'o' }));
  createAnswer: Mock = vi.fn(() => Promise.resolve({ type: 'answer', sdp: 'a' }));
  close: Mock = vi.fn();
  /** Set to make the next setRemoteDescription fail. */
  failRemote = false;
  readonly calls: string[] = [];
  constructor(readonly config: RTCConfiguration) {
    FakePeer.all.push(this);
  }
  addTrack(t: FakeTrack) {
    this.calls.push('addTrack');
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
    this.calls.push('setLocal');
    this.localDescription = { toJSON: () => d };
    return Promise.resolve();
  }
  setRemoteDescription(d: unknown) {
    this.calls.push('setRemote');
    if (this.failRemote) return Promise.reject(new Error('bad sdp'));
    this.remoteDescription = d;
    return Promise.resolve();
  }
  addIceCandidate: Mock = vi.fn((_c: unknown) => Promise.resolve());
  /** Move the connection and fire the handler like the browser does. */
  setConnection(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
}

export interface FakeMedia {
  camera: FakeTrack;
  getUserMedia: Mock<(constraints?: { video?: unknown; audio?: unknown }) => Promise<FakeStream>>;
  getDisplayMedia: ReturnType<typeof vi.fn>;
  enumerateDevices: ReturnType<typeof vi.fn>;
  /** Whether a video call gets a camera track. */
  hasCamera: boolean;
  /** Whether the next getUserMedia rejects, with this error name. */
  rejectWith: string | null;
}

/** Installs RTCPeerConnection, MediaStream and navigator.mediaDevices. Call vi.unstubAllGlobals() after. */
export const installFakeWebRtc = (): FakeMedia => {
  FakePeer.all = [];
  const media: FakeMedia = {
    camera: makeTrack('video'),
    getUserMedia:
      vi.fn<(constraints?: { video?: unknown; audio?: unknown }) => Promise<FakeStream>>(),
    getDisplayMedia: vi.fn(() => Promise.resolve(new FakeStream([makeTrack('video', 'screen')]))),
    enumerateDevices: vi.fn(() => Promise.resolve([])),
    hasCamera: true,
    rejectWith: null,
  };
  media.getUserMedia.mockImplementation((constraints) => {
    if (media.rejectWith) {
      const error = new Error('denied');
      error.name = media.rejectWith;
      return Promise.reject(error);
    }
    const tracks = [makeTrack('audio')];
    if (constraints?.video && media.hasCamera) tracks.push(media.camera);
    return Promise.resolve(new FakeStream(tracks));
  });
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.stubGlobal('MediaStream', FakeStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: media.getUserMedia,
      getDisplayMedia: media.getDisplayMedia,
      enumerateDevices: media.enumerateDevices,
    },
  });
  return media;
};
