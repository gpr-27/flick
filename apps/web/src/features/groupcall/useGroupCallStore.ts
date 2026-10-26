// Group calls through LiveKit (an SFU: everyone sends one stream to the server, which forwards it).
// The library is loaded with import() the first time someone joins, so it stays out of the main
// bundle. The store keeps plain snapshots of the room for the UI; the Room object stays private.
import { handleCaptionMessage, setCaptionSender } from '../platform/captions';
import { create } from 'zustand';
import { ENDPOINTS } from '@chat/contracts';
import type * as LK from 'livekit-client';
import { notify } from '@/components/ui/notify';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import { groupCallErrorMessage } from './errors';

type LiveKit = typeof LK;
type Room = LK.Room;
type Participant = LK.Participant;

/** Join the group call of a conversation, or any call through its link code. */
export type JoinTarget = { conversation_id: string } | { call_link: string };

export type GroupCallStatus = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'error';

export interface ParticipantTile {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  sharing: boolean;
  /** Screen share if there is one, else the camera; null when no picture is available. */
  videoTrack: MediaStreamTrack | null;
}

/** A floating emoji; `left` is its horizontal spot in percent. */
export interface Reaction {
  id: number;
  emoji: string;
  left: number;
}

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '🎉'];

interface GroupCallState {
  reactions: Reaction[];
  status: GroupCallStatus;
  error: string | null;
  callId: string | null;
  participants: ParticipantTile[];
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;

  join: (target: JoinTarget) => Promise<void>;
  leave: () => void;
  dismissError: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  sendReaction: (emoji: string) => Promise<void>;
}

const idle: Pick<
  GroupCallState,
  'status' | 'error' | 'callId' | 'participants' | 'micOn' | 'cameraOn' | 'sharing' | 'reactions'
> = {
  reactions: [],
  status: 'idle',
  error: null,
  callId: null,
  participants: [],
  micOn: false,
  cameraOn: false,
  sharing: false,
};

// Not in the store: the UI never needs them, and they would be compared and copied on every update.
let room: Room | null = null;

const removeAudioElements = (): void => {
  document.querySelectorAll('audio[data-group-call]').forEach((el) => {
    el.remove();
  });
};

const tileOf = (lk: LiveKit, p: Participant): ParticipantTile => {
  const screen = p.getTrackPublication(lk.Track.Source.ScreenShare);
  const camera = p.getTrackPublication(lk.Track.Source.Camera);
  const shown = screen?.videoTrack && !screen.isMuted ? screen : camera;
  const track = shown?.videoTrack && !shown.isMuted ? shown.videoTrack.mediaStreamTrack : null;
  const known = useChatStore.getState().users[p.identity]?.display_name;
  return {
    identity: p.identity,
    name: p.name || known || 'Participant',
    isLocal: p.isLocal,
    speaking: p.isSpeaking,
    micOn: p.isMicrophoneEnabled,
    sharing: p.isScreenShareEnabled,
    videoTrack: track,
  };
};

// While in a conversation's call, tell the server "still here" so the chat banner knows the call
// is on; when we leave (or the beats stop), the call ends once nobody is left.
const BEAT_MS = 25_000;
let beatTimer: ReturnType<typeof setInterval> | null = null;
let beatConversation: string | null = null;

const sendBeat = (conversationId: string, action: 'beat' | 'leave'): void => {
  void getApi()
    .call(ENDPOINTS.calls.groupBeat, { body: { conversation_id: conversationId, action } })
    .catch(() => undefined);
};

const startBeats = (conversationId: string): void => {
  stopBeats();
  beatConversation = conversationId;
  beatTimer = setInterval(() => {
    sendBeat(conversationId, 'beat');
  }, BEAT_MS);
};

function stopBeats(): void {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  if (beatConversation) sendBeat(beatConversation, 'leave');
  beatConversation = null;
}

export const useGroupCallStore = create<GroupCallState>()((set, get) => {
  const leaveRoom = (): void => {
    stopBeats();
    const current = room;
    room = null;
    setCaptionSender(null);
    removeAudioElements();
    current?.disconnect().catch(() => undefined);
    set({ ...idle });
  };

  const snapshot = (lk: LiveKit): void => {
    if (!room) return;
    const local = room.localParticipant;
    set({
      participants: [local, ...room.remoteParticipants.values()].map((p) => tileOf(lk, p)),
      micOn: local.isMicrophoneEnabled,
      cameraOn: local.isCameraEnabled,
      sharing: local.isScreenShareEnabled,
    });
  };

  const fail = (message: string): void => {
    stopBeats();
    const current = room;
    room = null;
    setCaptionSender(null);
    removeAudioElements();
    current?.disconnect().catch(() => undefined);
    set({ ...idle, status: 'error', error: message });
  };

  let reactionId = 0;
  const showReaction = (emoji: string): void => {
    if (!REACTION_EMOJIS.includes(emoji)) return;
    const reaction = { id: ++reactionId, emoji, left: 10 + Math.random() * 80 };
    set({ reactions: [...get().reactions, reaction] });
    setTimeout(() => {
      set({ reactions: get().reactions.filter((r) => r.id !== reaction.id) });
    }, 2500);
  };

  const watch = (lk: LiveKit, r: Room): void => {
    const E = lk.RoomEvent;
    const refresh = (): void => {
      if (room === r) snapshot(lk);
    };
    for (const event of [
      E.ParticipantConnected,
      E.ParticipantDisconnected,
      E.TrackMuted,
      E.TrackUnmuted,
      E.LocalTrackPublished,
      E.LocalTrackUnpublished,
      E.ActiveSpeakersChanged,
    ] as const) {
      r.on(event, refresh);
    }
    r.on(E.TrackSubscribed, (track) => {
      // Video is drawn by the tiles; sound needs an <audio> element of its own.
      if (track.kind === lk.Track.Kind.Audio) {
        const el = track.attach();
        el.dataset.groupCall = 'true';
        document.body.appendChild(el);
      }
      refresh();
    });
    r.on(E.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => {
        el.remove();
      });
    });
    r.on(E.DataReceived, (payload) => {
      if (room !== r) return;
      const text = new TextDecoder().decode(payload);
      if (!handleCaptionMessage(text)) showReaction(text);
    });
    r.on(E.Reconnecting, () => {
      if (room === r) set({ status: 'reconnecting' });
    });
    r.on(E.Reconnected, () => {
      if (room === r) set({ status: 'connected' });
    });
    r.on(E.Disconnected, () => {
      if (room !== r) return; // we left on purpose
      leaveRoom();
      notify.info('You were disconnected from the call');
    });
  };

  return {
    ...idle,

    join: async (target) => {
      if (get().status !== 'idle' && get().status !== 'error') return;
      if (useCallStore.getState().callStatus !== 'idle') {
        notify.error('Finish your current call first.');
        return;
      }
      set({ ...idle, status: 'joining' });
      let token;
      try {
        token = await getApi().call(ENDPOINTS.calls.livekitToken, { body: target });
      } catch (error) {
        logger.warn('LiveKit token failed:', error);
        set({ ...idle, status: 'error', error: groupCallErrorMessage(error) });
        return;
      }
      // Hung up (or closed the panel) while the token was loading.
      if (get().status !== 'joining') return;

      try {
        const lk = await import('livekit-client');
        if (get().status !== 'joining') return;
        const next = new lk.Room({ adaptiveStream: true, dynacast: true });
        room = next;
        watch(lk, next);
        await next.connect(token.url, token.token);
        if (room !== next) return;
        set({ status: 'connected', callId: token.call_id });
        setCaptionSender((text) => {
          void next.localParticipant
            .publishData(new TextEncoder().encode(text), { reliable: true })
            .catch(() => undefined);
        });
        if ('conversation_id' in target) startBeats(target.conversation_id);
        snapshot(lk);
        void next.startAudio().catch(() => undefined);
        try {
          await next.localParticipant.setMicrophoneEnabled(true);
        } catch {
          notify.error('Microphone is blocked. You joined muted.');
        }
        if (room === next) snapshot(lk);
      } catch (error) {
        logger.warn('LiveKit connect failed:', error);
        fail('Could not connect to the call. Please try again.');
      }
    },

    leave: leaveRoom,

    dismissError: () => {
      if (get().status === 'error') set({ ...idle });
    },

    toggleMic: async () => {
      const current = room;
      if (!current) return;
      await current.localParticipant.setMicrophoneEnabled(
        !current.localParticipant.isMicrophoneEnabled,
      );
    },

    toggleCamera: async () => {
      const current = room;
      if (!current) return;
      try {
        await current.localParticipant.setCameraEnabled(!current.localParticipant.isCameraEnabled);
      } catch {
        notify.error('Could not turn the camera on.');
      }
    },

    sendReaction: async (emoji) => {
      if (!room) return;
      showReaction(emoji);
      try {
        await room.localParticipant.publishData(new TextEncoder().encode(emoji), {
          reliable: false,
        });
      } catch {
        // others just do not see it
      }
    },

    toggleScreenShare: async () => {
      const current = room;
      if (!current) return;
      try {
        await current.localParticipant.setScreenShareEnabled(
          !current.localParticipant.isScreenShareEnabled,
        );
      } catch (error) {
        // Closing the browser's picker is a normal way to cancel.
        if (!(error instanceof Error && error.name === 'NotAllowedError'))
          notify.error('Could not share your screen.');
      }
    },
  };
});
