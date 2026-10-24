// 1:1 WebRTC call state machine. Signalling goes through the RealtimeTransport as the protocol's
// call_* events (the server routes them to the other member of the conversation); media is
// peer-to-peer, relayed by TURN when set.
import { create } from 'zustand';
import { randomId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { getTransport } from '@/lib/services';
import type { ClientEvents, RealtimeTransport, Unsubscribe } from '@/lib/realtime';
import { notify } from '@/components/ui/notify';
import { useChatStore } from '@/features/chat/useChatStore';
import type { CallType, PeerSummary } from '@/types/domain';
import { fetchIceServers } from './iceServers';
import {
  capVideoBitrate,
  describeError,
  errorName,
  getLocalMedia,
  hasMediaSupport,
  mediaErrorMessage,
} from './media';

/** An unanswered outgoing call gives up after this long. */
export const RING_TIMEOUT_MS = 45_000;
/** How long a dropped media path may try to recover (ICE restart) before the call ends. */
export const RECONNECT_GRACE_MS = 15_000;
/** How long the "call failed" message stays on screen. */
export const FAILURE_SHOWN_MS = 6_000;

export type CallStatus = 'idle' | 'calling' | 'ringing' | 'connected';
export type MediaConnectionState = 'new' | 'connecting' | 'connected' | 'reconnecting';
type TimerName = 'ring' | 'reconnect';

interface PendingCandidate {
  callId: string;
  candidate: RTCIceCandidateInit;
}

/** The contract's session description is only ever an offer or an answer. */
const toSdp = (d: RTCSessionDescriptionInit): { type: 'offer' | 'answer'; sdp: string } => ({
  type: d.type === 'offer' ? 'offer' : 'answer',
  sdp: d.sdp ?? '',
});

export interface DeviceLists {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

interface CallData {
  callStatus: CallStatus;
  connectionState: MediaConnectionState;
  callId: string | null;
  conversationId: string | null;
  callType: CallType | null;
  otherUser: PeerSummary | null;
  isCaller: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  /** True while the outgoing video is the shared screen instead of the camera. */
  isSharing: boolean;
  /** The shared screen, for the local preview. */
  screenStream: MediaStream | null;
  audioInputId: string | null;
  videoInputId: string | null;
  /**
   * Bumped whenever a stream's tracks change without the stream reference
   * changing (device swap locally, late-arriving track remotely) so the UI
   * re-attaches it to its media element.
   */
  streamEpoch: number;
  remoteEpoch: number;
  // internal (not for UI)
  _peer: RTCPeerConnection | null;
  /** TURN/STUN servers fetched for this call (reused by an ICE restart). */
  _iceServers: RTCIceServer[];
  _incomingOffer: RTCSessionDescriptionInit | null;
  /** ICE candidates that arrived before the remote description. */
  _pendingCandidates: PendingCandidate[];
  _timers: Partial<Record<TimerName, ReturnType<typeof setTimeout>>>;
}

interface CallState extends CallData {
  devices: DeviceLists;
  /** Selected speaker (null = system default); a cross-call preference. */
  audioOutputId: string | null;
  /** Why the last call could not start or was lost; shown briefly, then cleared. */
  failure: string | null;

  initiateCall: (conversationId: string, user: PeerSummary, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  clearFailure: () => void;
  loadDevices: () => Promise<void>;
  setAudioOutput: (deviceId: string) => void;
  setAudioInput: (deviceId: string) => Promise<void>;
  setVideoInput: (deviceId: string) => Promise<void>;

  _setTimer: (name: TimerName, ms: number, fn: () => void) => void;
  _clearTimer: (name: TimerName) => void;
  _emit: <K extends CallSignal>(event: K, payload: Omit<ClientEvents[K], 'call_id'>) => void;
  _createPeer: (iceServers: RTCIceServer[]) => RTCPeerConnection;
  _fail: (message: string) => void;
  _negotiate: (iceRestart?: boolean) => Promise<void>;
  _flushCandidates: () => Promise<void>;
  _cleanup: () => void;
}

type CallSignal =
  'call_offer' | 'call_answer' | 'call_renegotiate' | 'call_ice' | 'call_reject' | 'call_end';

const initialCallState = (): CallData => ({
  callStatus: 'idle',
  connectionState: 'new',
  callId: null,
  conversationId: null,
  callType: null,
  otherUser: null,
  isCaller: false,
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isCameraOff: false,
  isSharing: false,
  screenStream: null,
  audioInputId: null,
  videoInputId: null,
  streamEpoch: 0,
  remoteEpoch: 0,
  _peer: null,
  _iceServers: [],
  _incomingOffer: null,
  _pendingCandidates: [],
  _timers: {},
});

const resolveUser = (userId: string): PeerSummary => {
  const user = useChatStore.getState().users[userId];
  return user
    ? { id: user.id, display_name: user.display_name, avatar_url: user.avatar_url }
    : { id: userId, display_name: 'Unknown', avatar_url: null };
};

const trackDeviceId = (track: MediaStreamTrack | undefined): string | null =>
  track?.getSettings().deviceId ?? null;

const transport = (): RealtimeTransport => getTransport();

// Outside the store so a later _cleanup() (which clears the call's own timers) cannot cancel it.
let failureTimer: ReturnType<typeof setTimeout> | undefined;

export const useCallStore = create<CallState>()((set, get) => ({
  ...initialCallState(),
  devices: { mics: [], speakers: [], cameras: [] },
  audioOutputId: null,
  failure: null,

  // ── internal helpers ────────────────────────────────────────────────────
  _setTimer: (name, ms, fn) => {
    get()._clearTimer(name);
    const id = setTimeout(() => {
      const timers = get()._timers;
      if (timers[name] === id) {
        const { [name]: _done, ...rest } = timers;
        set({ _timers: rest });
      }
      fn();
    }, ms);
    set({ _timers: { ...get()._timers, [name]: id } });
  },

  _clearTimer: (name) => {
    const { [name]: id, ...rest } = get()._timers;
    if (id) clearTimeout(id);
    set({ _timers: rest });
  },

  _emit: (event, payload) => {
    const { callId } = get();
    if (!callId) return;
    // The payload type is checked per event at the call sites via CallSignal.
    transport().send(event, { call_id: callId, ...payload } as ClientEvents[typeof event]);
  },

  _createPeer: (iceServers) => {
    set({ _iceServers: iceServers });
    const peer = new RTCPeerConnection({ iceServers });

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate.toJSON();
      get()._emit('call_ice', { candidate: { candidate: candidate ?? '', sdpMid, sdpMLineIndex } });
    };

    // Tracks may arrive with or without an associated stream, and video often
    // lands after audio. Collect them into one remote stream and bump
    // remoteEpoch so the UI re-attaches it.
    peer.ontrack = (event) => {
      let stream = event.streams[0];
      if (!stream) {
        stream = get().remoteStream ?? new MediaStream();
        if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      }
      set((s) => ({ remoteStream: stream, remoteEpoch: s.remoteEpoch + 1 }));
      const bump = (): void => {
        set((s) => ({ remoteEpoch: s.remoteEpoch + 1 }));
      };
      event.track.onunmute = bump;
      event.track.onmute = bump;
    };

    peer.onconnectionstatechange = () => {
      if (get()._peer !== peer) return;
      const state = peer.connectionState;
      if (state === 'connected') {
        get()._clearTimer('reconnect');
        set({ connectionState: 'connected' });
      } else if (state === 'disconnected' || state === 'failed') {
        // Often transient (network switch): try an ICE restart within a grace period.
        set({ connectionState: 'reconnecting' });
        if (state === 'failed' || !get()._timers.reconnect) void get()._negotiate(true);
        if (!get()._timers.reconnect) {
          get()._setTimer('reconnect', RECONNECT_GRACE_MS, () => {
            if (get()._peer === peer && peer.connectionState !== 'connected') {
              get().endCall();
              get()._fail('Call dropped: the connection was lost.');
            }
          });
        }
      }
    };

    return peer;
  },

  // A new offer on the live connection: an ICE restart (driven by the caller only, to avoid offer
  // glare) or a change of tracks such as starting a screen share. The other side answers it in the
  // call_renegotiate handler.
  _negotiate: async (iceRestart = false) => {
    const { _peer, isCaller } = get();
    if (!_peer || (iceRestart && !isCaller) || _peer.signalingState !== 'stable') return;
    try {
      const offer = await _peer.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await _peer.setLocalDescription(offer);
      if (_peer.localDescription)
        get()._emit('call_renegotiate', { sdp: toSdp(_peer.localDescription.toJSON()) });
    } catch (error) {
      logger.warn('Renegotiation failed:', describeError(error));
    }
  },

  // A call that could not start or was lost: shown as a message after the overlay closes.
  _fail: (message) => {
    clearTimeout(failureTimer);
    set({ failure: message });
    failureTimer = setTimeout(() => {
      set({ failure: null });
    }, FAILURE_SHOWN_MS);
  },

  clearFailure: () => {
    clearTimeout(failureTimer);
    set({ failure: null });
  },

  _flushCandidates: async () => {
    const { _peer, _pendingCandidates, callId } = get();
    if (!_peer) return;
    set({ _pendingCandidates: [] });
    for (const item of _pendingCandidates) {
      if (item.callId !== callId) continue;
      try {
        await _peer.addIceCandidate(item.candidate);
      } catch {
        // ignore candidates that fail to apply
      }
    }
  },

  _cleanup: () => {
    const { _peer, localStream, screenStream, _timers } = get();
    for (const id of Object.values(_timers)) clearTimeout(id);
    screenStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    localStream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (_peer) {
      _peer.onicecandidate = null;
      _peer.ontrack = null;
      _peer.onconnectionstatechange = null;
      _peer.close();
    }
    // audioOutputId / devices are kept as cross-call preferences.
    set(initialCallState());
  },

  // ── outgoing call ───────────────────────────────────────────────────────
  initiateCall: async (conversationId, user, type) => {
    if (transport().state !== 'connected') {
      notify.error('Not connected — please wait a moment and retry');
      return;
    }
    if (get().callStatus !== 'idle') return;
    if (!hasMediaSupport()) {
      get()._fail('Calls need a secure connection (HTTPS or localhost).');
      return;
    }

    get().clearFailure();
    const callId = randomId();
    // Show the outgoing-call UI immediately (permission prompts can take a while).
    set({
      callId,
      conversationId,
      isCaller: true,
      otherUser: { id: user.id, display_name: user.display_name, avatar_url: user.avatar_url },
      callType: type,
      callStatus: 'calling',
      connectionState: 'new',
    });

    try {
      const stream = await getLocalMedia(type);
      if (get().callId !== callId) {
        // Hung up while the permission prompt was open.
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      const iceServers = await fetchIceServers();
      if (get().callId !== callId) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      const peer = get()._createPeer(iceServers);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      // Always negotiate a video m-line for video calls, even without a camera,
      // so we can still RECEIVE the other side's video.
      if (type === 'video' && stream.getVideoTracks().length === 0) {
        peer.addTransceiver('video', { direction: 'recvonly' });
      }

      set({
        localStream: stream,
        _peer: peer,
        audioInputId: trackDeviceId(stream.getAudioTracks()[0]),
        videoInputId: trackDeviceId(stream.getVideoTracks()[0]),
      });
      void get().loadDevices();

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await capVideoSenders(peer);
      if (peer.localDescription) {
        get()._emit('call_offer', {
          conversation_id: conversationId,
          media: type,
          sdp: toSdp(peer.localDescription.toJSON()),
        });
      }

      get()._setTimer('ring', RING_TIMEOUT_MS, () => {
        if (get().callId === callId && get().callStatus === 'calling') {
          notify.info(`${user.display_name || 'User'} didn't answer`);
          get().endCall();
        }
      });
    } catch (error) {
      logger.warn('initiateCall error:', describeError(error));
      get()._cleanup();
      get()._fail(mediaErrorMessage(error));
    }
  },

  // ── answering ───────────────────────────────────────────────────────────
  acceptCall: async () => {
    const { otherUser, _incomingOffer, callType, callId } = get();
    if (!otherUser || !_incomingOffer || !callType) return;
    if (!hasMediaSupport()) {
      get()._emit('call_reject', {});
      get()._cleanup();
      get()._fail('Calls need a secure connection (HTTPS or localhost).');
      return;
    }

    try {
      const stream = await getLocalMedia(callType);
      if (get().callId !== callId) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      const iceServers = await fetchIceServers();
      if (get().callId !== callId) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        return;
      }

      const peer = get()._createPeer(iceServers);
      set({ _peer: peer, localStream: stream });

      // Apply the caller's offer BEFORE attaching local tracks so addTrack
      // reuses the transceivers created from the offer (both directions sendrecv).
      await peer.setRemoteDescription(_incomingOffer);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      await capVideoSenders(peer);

      set({
        audioInputId: trackDeviceId(stream.getAudioTracks()[0]),
        videoInputId: trackDeviceId(stream.getVideoTracks()[0]),
      });
      void get().loadDevices();
      await get()._flushCandidates();

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (peer.localDescription)
        get()._emit('call_answer', { sdp: toSdp(peer.localDescription.toJSON()) });

      set({ callStatus: 'connected', connectionState: 'connecting', _incomingOffer: null });
    } catch (error) {
      logger.warn('acceptCall error:', describeError(error));
      get()._emit('call_reject', {});
      get()._cleanup();
      get()._fail(mediaErrorMessage(error));
    }
  },

  rejectCall: () => {
    get()._emit('call_reject', {});
    get()._cleanup();
  },

  // Hang up an active or ringing-out call.
  endCall: () => {
    get()._emit('call_end', { reason: 'hangup' });
    get()._cleanup();
  },

  toggleMute: () => {
    const { localStream, isMuted } = get();
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = isMuted;
    });
    set({ isMuted: !isMuted });
  },

  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = isCameraOff;
    });
    set({ isCameraOff: !isCameraOff });
  },

  // ── screen sharing ──────────────────────────────────────────────────────
  // The outgoing video track is swapped for the screen with replaceTrack (no new connection). If
  // the video line was receive-only (no camera), it is switched to send+receive and renegotiated.
  startScreenShare: async () => {
    const { _peer, callType, isSharing } = get();
    if (!_peer || callType !== 'video' || isSharing) return;
    if (!('getDisplayMedia' in navigator.mediaDevices)) {
      notify.error('Screen sharing is not supported in this browser.');
      return;
    }
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (error) {
      // Closing the picker is not an error.
      if (errorName(error) !== 'NotAllowedError') notify.error('Could not share your screen.');
      return;
    }
    const track = screen.getVideoTracks()[0];
    const transceiver = _peer.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    if (!track || !transceiver || get()._peer !== _peer) {
      screen.getTracks().forEach((t) => {
        t.stop();
      });
      return;
    }
    try {
      await transceiver.sender.replaceTrack(track);
      const needsRenegotiation = transceiver.direction !== 'sendrecv';
      if (needsRenegotiation) {
        transceiver.direction = 'sendrecv';
        await get()._negotiate();
      }
    } catch (error) {
      logger.warn('startScreenShare error:', describeError(error));
      track.stop();
      notify.error('Could not share your screen.');
      return;
    }
    // The browser's own "Stop sharing" button ends the track: undo it the same way.
    track.onended = () => {
      void get().stopScreenShare();
    };
    set({ isSharing: true, screenStream: screen });
  },

  stopScreenShare: async () => {
    const { _peer, screenStream, localStream } = get();
    if (!screenStream) return;
    set({ isSharing: false, screenStream: null });
    screenStream.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    // Back to the camera (or to nothing when the call has no camera).
    const camera = localStream?.getVideoTracks()[0] ?? null;
    const sender = _peer?.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
    try {
      await sender?.replaceTrack(camera);
    } catch (error) {
      logger.warn('stopScreenShare error:', describeError(error));
    }
  },

  // ── device selection ────────────────────────────────────────────────────
  // Labels are only populated after getUserMedia permission, so call this
  // once a call has its local stream.
  loadDevices: async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      set({
        devices: {
          mics: list.filter((d) => d.kind === 'audioinput'),
          speakers: list.filter((d) => d.kind === 'audiooutput'),
          cameras: list.filter((d) => d.kind === 'videoinput'),
        },
      });
    } catch (error) {
      logger.warn('loadDevices error:', describeError(error));
    }
  },

  // Output-only: applied by the <audio> element's setSinkId in the UI.
  setAudioOutput: (deviceId) => {
    set({ audioOutputId: deviceId });
  },

  // Switch microphone mid-call: swap the track into the peer connection (no
  // renegotiation) and into the local stream.
  setAudioInput: async (deviceId) => {
    const { _peer, localStream, isMuted } = get();
    if (!localStream) {
      set({ audioInputId: deviceId });
      return;
    }
    try {
      const ns = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newTrack = ns.getAudioTracks()[0];
      if (!newTrack) throw new Error('No audio track from the selected device');
      newTrack.enabled = !isMuted;
      const sender = _peer?.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
      localStream.getAudioTracks().forEach((t) => {
        localStream.removeTrack(t);
        t.stop();
      });
      localStream.addTrack(newTrack);
      set((s) => ({ audioInputId: deviceId, streamEpoch: s.streamEpoch + 1 }));
    } catch (error) {
      logger.warn('setAudioInput error:', describeError(error));
      notify.error('Could not switch microphone');
    }
  },

  // Switch camera mid-call (video calls only).
  setVideoInput: async (deviceId) => {
    const { _peer, localStream, isCameraOff } = get();
    if (!localStream) {
      set({ videoInputId: deviceId });
      return;
    }
    try {
      const ns = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = ns.getVideoTracks()[0];
      if (!newTrack) throw new Error('No video track from the selected device');
      newTrack.enabled = !isCameraOff;
      const sender = _peer?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        await capVideoBitrate(sender);
      }
      localStream.getVideoTracks().forEach((t) => {
        localStream.removeTrack(t);
        t.stop();
      });
      localStream.addTrack(newTrack);
      set((s) => ({ videoInputId: deviceId, streamEpoch: s.streamEpoch + 1 }));
    } catch (error) {
      logger.warn('setVideoInput error:', describeError(error));
      notify.error('Could not switch camera');
    }
  },
}));

/** Every video sender on this connection gets the bitrate cap. Never fails the call over it. */
async function capVideoSenders(peer: RTCPeerConnection): Promise<void> {
  for (const sender of peer.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    try {
      await capVideoBitrate(sender);
    } catch (error) {
      logger.warn('could not cap video bitrate:', describeError(error));
    }
  }
}

// ── signaling wiring ──────────────────────────────────────────────────────

/** Subscribes the call store to signaling events. Returns the unsubscribe. */
export const bindCallRealtime = (t: RealtimeTransport): Unsubscribe => {
  const get = useCallStore.getState;
  const set = useCallStore.setState;
  // Is this event for the call we're currently in?
  const isCurrent = (callId: string): boolean => Boolean(callId) && callId === get().callId;
  const nameOf = (): string => get().otherUser?.display_name || 'User';

  const offs: Unsubscribe[] = [
    t.on('call_offer', ({ call_id, media, sdp, from_user_id }) => {
      // Already busy: tell the caller we're on another call.
      if (get().callStatus !== 'idle') {
        t.send('call_busy', { call_id });
        return;
      }
      set({
        callId: call_id,
        isCaller: false,
        callStatus: 'ringing',
        connectionState: 'new',
        callType: media,
        otherUser: resolveUser(from_user_id),
        _incomingOffer: sdp,
        _pendingCandidates: get()._pendingCandidates.filter((c) => c.callId === call_id),
      });
      // Safety net in case the caller vanishes without a hang-up reaching us.
      get()._setTimer('ring', RING_TIMEOUT_MS + 5000, () => {
        if (get().callId === call_id && get().callStatus === 'ringing') get()._cleanup();
      });
    }),

    t.on('call_answer', ({ call_id, sdp }) => {
      const peer = get()._peer;
      if (!peer || !isCurrent(call_id)) return;
      void (async () => {
        try {
          get()._clearTimer('ring');
          await peer.setRemoteDescription(sdp);
          await get()._flushCandidates();
          set({ callStatus: 'connected', connectionState: 'connecting' });
        } catch (error) {
          logger.warn('call_answer error:', describeError(error));
          notify.error('Call failed to connect');
          get().endCall();
        }
      })();
    }),

    // ICE-restart offer (callee side) or its answer (caller side).
    t.on('call_renegotiate', ({ call_id, sdp }) => {
      const peer = get()._peer;
      if (!peer || !isCurrent(call_id)) return;
      void (async () => {
        try {
          await peer.setRemoteDescription(sdp);
          if (sdp.type === 'offer') {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            if (peer.localDescription)
              get()._emit('call_renegotiate', { sdp: toSdp(peer.localDescription.toJSON()) });
          }
          await get()._flushCandidates();
        } catch (error) {
          logger.warn('call_renegotiate error:', describeError(error));
        }
      })();
    }),

    t.on('call_ice', ({ call_id, candidate }) => {
      if (!candidate) return; // null = the other side has no more candidates
      const peer = get()._peer;
      // Not our current call yet (e.g. still ringing, no peer): buffer it. The
      // buffer is filtered by call id when flushed.
      if (!peer?.remoteDescription || !isCurrent(call_id)) {
        if (get().callStatus === 'idle' || isCurrent(call_id)) {
          set((s) => ({
            _pendingCandidates: [...s._pendingCandidates, { callId: call_id, candidate }],
          }));
        }
        return;
      }
      peer.addIceCandidate(candidate).catch(() => undefined);
    }),

    t.on('call_reject', ({ call_id }) => {
      if (!isCurrent(call_id)) return;
      notify.info(`${nameOf()} declined the call`);
      get()._cleanup();
    }),

    // Only the caller gets this: the other person blocked them, or has no connected device.
    t.on('call_unavailable', ({ call_id, reason }) => {
      if (!isCurrent(call_id)) return;
      const name = nameOf();
      get()._cleanup();
      get()._fail(
        reason === 'offline' ? `${name} is offline right now.` : `You can't call ${name}.`,
      );
    }),

    t.on('call_busy', ({ call_id }) => {
      if (!isCurrent(call_id)) return;
      notify.info(`${nameOf()} is on another call`);
      get()._cleanup();
    }),

    t.on('call_end', ({ call_id, reason }) => {
      if (!isCurrent(call_id)) return;
      // Answered or declined on another of our own devices: just stop ringing here.
      if (reason === 'answered_elsewhere') {
        if (get().callStatus === 'ringing') get()._cleanup();
        return;
      }
      notify.info(get().callStatus === 'ringing' ? 'Missed call' : 'Call ended');
      get()._cleanup();
    }),
  ];

  return () => {
    for (const off of offs) off();
  };
};
