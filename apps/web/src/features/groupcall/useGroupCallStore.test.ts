import { beforeEach, describe, expect, it, vi } from 'vitest';

// A small stand-in for livekit-client: a room that records what the store asks of it and lets the
// test fire room events.
const lk = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  class FakeParticipant {
    isSpeaking = false;
    isMicrophoneEnabled = false;
    isCameraEnabled = false;
    isScreenShareEnabled = false;
    publications: Record<string, unknown> = {};
    constructor(
      readonly identity: string,
      readonly name: string,
      readonly isLocal: boolean,
      private readonly room?: FakeRoom,
    ) {}
    getTrackPublication = (source: string) => this.publications[source];
    setMicrophoneEnabled = vi.fn((on: boolean) => {
      if (FakeRoom.micError) return Promise.reject(new Error('denied'));
      this.isMicrophoneEnabled = on;
      this.room?.emit('localTrackPublished');
      return Promise.resolve();
    });
    setCameraEnabled = vi.fn((on: boolean) => {
      this.isCameraEnabled = on;
      return Promise.resolve();
    });
    setScreenShareEnabled = vi.fn((on: boolean) => {
      this.isScreenShareEnabled = on;
      return Promise.resolve();
    });
  }

  class FakeRoom {
    static last: FakeRoom;
    static connectError: Error | null = null;
    static micError = false;
    handlers = new Map<string, Handler[]>();
    remoteParticipants = new Map<string, FakeParticipant>();
    localParticipant = new FakeParticipant('me', 'Me', true, this);
    connect = vi.fn(() =>
      FakeRoom.connectError ? Promise.reject(FakeRoom.connectError) : Promise.resolve(),
    );
    disconnect = vi.fn(() => Promise.resolve());
    startAudio = vi.fn(() => Promise.resolve());
    constructor() {
      FakeRoom.last = this;
    }
    on(event: string, fn: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.forEach((fn) => {
        fn(...args);
      });
    }
  }
  return { FakeRoom, FakeParticipant };
});

vi.mock('livekit-client', () => ({
  Room: lk.FakeRoom,
  RoomEvent: {
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    LocalTrackPublished: 'localTrackPublished',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
  },
  Track: {
    Source: {
      Camera: 'camera',
      ScreenShare: 'screen_share',
      Microphone: 'microphone',
    },
    Kind: { Audio: 'audio', Video: 'video' },
  },
}));
vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { notify } from '@/components/ui/notify';
import { ApiError } from '@/lib/api';
import { useCallStore } from '@/features/calls/useCallStore';
import { CONV, type FakeApi, installFakeServices } from '../../../test/fakes';
import { useGroupCallStore } from './useGroupCallStore';

const TOKEN = {
  call_id: '0192f5a0-0000-7000-8000-000000000077',
  url: 'wss://lk.test',
  token: 'a-livekit-token-long-enough',
  expires_at: '2026-01-01T00:00:00.000Z',
};

let api: FakeApi;
beforeEach(() => {
  vi.clearAllMocks();
  lk.FakeRoom.connectError = null;
  lk.FakeRoom.micError = false;
  ({ api } = installFakeServices());
  api.call.mockResolvedValue(TOKEN);
  useCallStore.getState()._cleanup();
  useGroupCallStore.getState().leave();
});

const join = () => useGroupCallStore.getState().join({ conversation_id: CONV });
const state = () => useGroupCallStore.getState();

describe('joining a group call', () => {
  it('asks for a token, connects, and joins with the microphone on', async () => {
    await join();
    expect(api.call).toHaveBeenCalledWith(expect.anything(), {
      body: { conversation_id: CONV },
    });
    const room = lk.FakeRoom.last;
    expect(room.connect).toHaveBeenCalledWith(TOKEN.url, TOKEN.token);
    expect(state()).toMatchObject({
      status: 'connected',
      callId: TOKEN.call_id,
      micOn: true,
    });
    expect(state().participants.map((p) => p.identity)).toEqual(['me']);
  });

  it('joins through a call link', async () => {
    await state().join({ call_link: 'abcdefghij1234' });
    expect(api.call).toHaveBeenCalledWith(expect.anything(), {
      body: { call_link: 'abcdefghij1234' },
    });
    expect(state().status).toBe('connected');
  });

  it('shows who is in the call and who is speaking', async () => {
    await join();
    const room = lk.FakeRoom.last;
    const alice = new lk.FakeParticipant('u-alice', 'Alice', false);
    room.remoteParticipants.set('u-alice', alice);
    room.emit('participantConnected');
    expect(state().participants.map((p) => p.name)).toEqual(['Me', 'Alice']);

    alice.isSpeaking = true;
    room.emit('activeSpeakersChanged');
    expect(state().participants.find((p) => p.identity === 'u-alice')?.speaking).toBe(true);

    room.remoteParticipants.clear();
    room.emit('participantDisconnected');
    expect(state().participants).toHaveLength(1);
  });

  it('turns the microphone, camera and screen share on and off', async () => {
    await join();
    const me = lk.FakeRoom.last.localParticipant;
    await state().toggleMic();
    expect(me.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await state().toggleCamera();
    expect(me.setCameraEnabled).toHaveBeenLastCalledWith(true);
    await state().toggleScreenShare();
    expect(me.setScreenShareEnabled).toHaveBeenLastCalledWith(true);
  });

  it('keeps the call when the microphone is blocked, and says so', async () => {
    lk.FakeRoom.micError = true;
    await join();
    expect(state()).toMatchObject({ status: 'connected', micOn: false });
    expect(notify.error).toHaveBeenCalledWith('Microphone is blocked. You joined muted.');
  });
});

describe('group call errors', () => {
  const failWith = async (error: unknown) => {
    api.call.mockRejectedValue(error);
    await join();
  };

  it('explains that LiveKit is not configured (503)', async () => {
    await failWith(
      new ApiError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'off',
      }),
    );
    expect(state()).toMatchObject({
      status: 'error',
      error: 'Group calls are not set up on this server yet.',
    });
  });

  it('explains that the call is full', async () => {
    await failWith(new ApiError({ status: 409, code: 'GROUP_FULL', message: 'full' }));
    expect(state().error).toBe('This call is full.');
  });

  it('explains a missing or revoked call', async () => {
    await failWith(new ApiError({ status: 404, code: 'NOT_FOUND', message: 'gone' }));
    expect(state().error).toMatch(/no longer exists/);
  });

  it('reports a failed connection to the media server and cleans up', async () => {
    lk.FakeRoom.connectError = new Error('ws failed');
    await join();
    expect(state().status).toBe('error');
    expect(state().error).toMatch(/connect/);
    expect(lk.FakeRoom.last.disconnect).toHaveBeenCalled();
  });

  it('closes the error panel', async () => {
    await failWith(
      new ApiError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'off',
      }),
    );
    state().dismissError();
    expect(state().status).toBe('idle');
  });

  it('will not start while a 1:1 call is going', async () => {
    useCallStore.setState({ callStatus: 'connected' });
    await join();
    expect(api.call).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalled();
  });
});

describe('connection changes', () => {
  it('shows reconnecting and goes back to connected', async () => {
    await join();
    const room = lk.FakeRoom.last;
    room.emit('reconnecting');
    expect(state().status).toBe('reconnecting');
    room.emit('reconnected');
    expect(state().status).toBe('connected');
  });

  it('returns to idle and tells the user when the server drops them', async () => {
    await join();
    lk.FakeRoom.last.emit('disconnected');
    expect(state().status).toBe('idle');
    expect(notify.info).toHaveBeenCalledWith('You were disconnected from the call');
  });

  it('leaves the room on purpose without the disconnect notice', async () => {
    await join();
    const room = lk.FakeRoom.last;
    state().leave();
    room.emit('disconnected');
    expect(room.disconnect).toHaveBeenCalled();
    expect(state().status).toBe('idle');
    expect(notify.info).not.toHaveBeenCalled();
  });
});
